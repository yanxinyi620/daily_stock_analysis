"""Runner protocol tests; no real credentials, database or model calls."""
import json
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.services.cloud_runner import CloudRunner, RunnerSettings, RunnerError, RunnerTransport
from src.services.cloud_publisher import build_envelope, PublishError

USER = '11111111-1111-4111-8111-111111111111'
TASK = '22222222-2222-4222-8222-222222222222'


def settings(tmp_path):
    return RunnerSettings('local-primary', 0.01, 60, 30, 0.01, tmp_path)


def task():
    return {'id': TASK, 'user_id': USER, 'task_type': 'stock_analysis', 'input_json': {'stock_code': '000001'}}


def setup_runner(tmp_path, execute=None):
    transport = Mock(user_id=USER)
    transport.rpc.return_value = None
    publisher = Mock(user_id=USER)
    publisher.publish.return_value = 'succeeded'
    publisher.publish_for_task.side_effect = lambda envelope, **_kwargs: publisher.publish(envelope)
    execute = execute or Mock(return_value=('# report', [{'code': '000001'}]))
    return CloudRunner(settings(tmp_path), transport, publisher, execute), transport, publisher, execute


def test_publish_and_finish_only_after_private_package_saved(tmp_path):
    runner, transport, publisher, execute = setup_runner(tmp_path)
    publisher.publish.side_effect = lambda envelope: 'succeeded' if (tmp_path / f"{envelope['task_id']}.json").exists() else pytest.fail('missing retry package')
    runner.execute_task(task())
    execute.assert_called_once()
    package = json.loads(next(tmp_path.glob('*.json')).read_text())
    assert transport.rpc.call_args.args[0] == 'cloud_finish_execution'
    assert transport.rpc.call_args.kwargs['p_report_id'] == package['task_id']
    assert next(tmp_path.glob('*.json')).stat().st_mode & 0o777 == 0o600


def test_publish_retry_never_reexecutes_engine(tmp_path):
    runner, transport, publisher, execute = setup_runner(tmp_path)
    publisher.publish.side_effect = [PublishError('network'), 'succeeded']
    runner.execute_task(task())
    assert execute.call_count == 1
    assert publisher.publish.call_count == 2
    assert publisher.publish.call_args_list[0] == publisher.publish.call_args_list[1]
    assert transport.rpc.call_args.kwargs['p_report_id'] is not None


def test_saved_package_resume_never_reexecutes_engine(tmp_path):
    runner, _, publisher, execute = setup_runner(tmp_path)
    envelope = build_envelope(USER, TASK, '# saved', [{'code': '000001'}])
    (tmp_path / f"{envelope['task_id']}.json").write_text(json.dumps(envelope))
    runner.execute_task(task())
    execute.assert_not_called()
    publisher.publish.assert_called_once_with(envelope)


def test_invalid_task_and_engine_failure_never_publish(tmp_path):
    for item in [dict(task(), user_id=TASK), dict(task(), task_type='ask')]:
        runner, _, publisher, execute = setup_runner(tmp_path)
        with pytest.raises(RunnerError): runner.execute_task(item)
        publisher.publish.assert_not_called(); execute.assert_not_called()
    runner, transport, publisher, _ = setup_runner(tmp_path, Mock(side_effect=RuntimeError('secretvalue')))
    runner.execute_task(task())
    publisher.publish.assert_not_called()
    assert transport.rpc.call_args.kwargs['p_error_code'] == 'ANALYSIS_FAILED'
    assert 'secretvalue' not in str(transport.rpc.call_args)


def test_heartbeat_continues_while_engine_is_blocked(tmp_path):
    heartbeat = threading.Event()
    runner, transport, _, _ = setup_runner(tmp_path, lambda *_: (heartbeat.wait(1) and '# done', [{'code': '000001'}]))
    transport.rpc.side_effect = lambda name, **kwargs: heartbeat.set() if name == 'cloud_runner_heartbeat' else None
    runner.start()
    try:
        runner.execute_task(task())
        assert heartbeat.is_set()
    finally: runner.close()
    assert transport.rpc.call_args.args[0] == 'cloud_runner_stop'


def test_transport_uses_timeout_no_redirect_and_redacts_backend(tmp_path):
    config = SimpleNamespace(supabase_url='https://example.supabase.co', supabase_secret_key='sb_secret_test', supabase_publish_user_id=USER, supabase_publish_timeout=3, enable_actions_dispatch=False)
    session = Mock()
    session.request.return_value = Mock(status_code=500, json=lambda: {'message': 'secret'})
    transport = RunnerTransport(config, session=session)
    with pytest.raises(RunnerError, match='RUNNER_TRANSPORT'):
        transport.rpc('cloud_claim_execution')
    assert session.request.call_args.kwargs['allow_redirects'] is False
    assert session.request.call_args.kwargs['timeout'] == 3


@pytest.mark.parametrize(
    ('online_seconds', 'claim_seconds'),
    [(15, 5), (300, 120)],
)
def test_runner_settings_accept_database_timing_boundaries(tmp_path, online_seconds, claim_seconds):
    config = SimpleNamespace(
        cloud_runner_id='local-primary',
        cloud_runner_heartbeat_seconds=1,
        cloud_runner_online_seconds=online_seconds,
        cloud_runner_claim_seconds=claim_seconds,
        cloud_runner_poll_seconds=1,
        log_dir=str(tmp_path),
    )

    settings = RunnerSettings.from_config(config)

    assert settings.online_seconds == online_seconds
    assert settings.claim_seconds == claim_seconds


@pytest.mark.parametrize(
    ('online_seconds', 'claim_seconds'),
    [(14, 5), (301, 5), (15, 4), (15, 16), (300, 121)],
)
def test_runner_settings_reject_timing_outside_database_bounds(tmp_path, online_seconds, claim_seconds):
    config = SimpleNamespace(
        cloud_runner_id='local-primary',
        cloud_runner_heartbeat_seconds=1,
        cloud_runner_online_seconds=online_seconds,
        cloud_runner_claim_seconds=claim_seconds,
        cloud_runner_poll_seconds=1,
        log_dir=str(tmp_path),
    )

    with pytest.raises(RunnerError, match='Invalid Runner timing'):
        RunnerSettings.from_config(config)


def test_runner_configuration_is_explicit_and_hidden_from_web(monkeypatch):
    from src.config import Config
    from src.core.config_registry import WEB_SETTINGS_HIDDEN_FROM_UI
    from src.services.system_config_service import SystemConfigService
    monkeypatch.setenv('CLOUD_RUNNER_ID', 'my-runner')
    monkeypatch.setenv('CLOUD_RUNNER_DATABASE_URL', 'postgresql+psycopg://user:secret@example/db?sslmode=verify-full')
    config = Config._load_from_env()
    assert config.cloud_runner_id == 'my-runner'
    assert config.cloud_runner_database_url.startswith('postgresql')
    assert 'secret@example' not in repr(config)
    assert 'CLOUD_RUNNER_DATABASE_URL' in WEB_SETTINGS_HIDDEN_FROM_UI
    assert 'CLOUD_RUNNER_DATABASE_URL' in SystemConfigService._SERVER_MASKED_CONFIG_KEYS
    assert config.get_db_url().startswith('sqlite:')  # Local CLI remains unchanged.


def test_runner_cli_stops_before_web_and_scheduler(monkeypatch):
    import main
    monkeypatch.setattr('sys.argv', ['main.py', '--runner'])
    assert main.parse_arguments().runner is True
    monkeypatch.setattr(main, '_setup_bootstrap_logging', Mock())
    monkeypatch.setattr(main, '_setup_runtime_logging', Mock())
    config = SimpleNamespace(log_dir='unused', validate=lambda: [], webui_enabled=True, schedule_enabled=True)
    monkeypatch.setattr(main, 'get_config', lambda: config)
    runner = Mock(return_value=0)
    monkeypatch.setattr('src.services.cloud_runner.run_cloud_runner', runner)
    assert main.main() == 0
    runner.assert_called_once_with(config)


def test_runner_publisher_commits_report_and_execution_through_one_fenced_rpc():
    from src.services.cloud_runner import RunnerPublisher
    config = SimpleNamespace(supabase_url='https://example.supabase.co', supabase_secret_key='sb_secret_test', supabase_publish_user_id=USER, supabase_publish_timeout=3, enable_actions_dispatch=False)
    session = Mock()
    session.request.side_effect = [Mock(status_code=200, json=lambda: 'publishing'), Mock(status_code=200, json=lambda: {}), Mock(status_code=200, json=lambda: 'succeeded')]
    publisher = RunnerPublisher(config, session=session)
    item = build_envelope(USER, TASK, '# report', [])
    publisher.publish_for_task(item, runner_id='local-primary', session_id=USER, execution_id=TASK)
    completion = session.request.call_args_list[2]
    assert completion.args[1].endswith('/rpc/cloud_complete_runner_publish')
    assert completion.kwargs['json']['p_task_id'] == TASK
    assert completion.kwargs['json']['p_report_id'] == item['task_id']


def test_lost_progress_lease_prevents_publication_even_if_engine_swallows_callback_error(tmp_path):
    runner, transport, publisher, _ = setup_runner(tmp_path)
    def execute(_task, progress):
        try: progress(50, 'private details')
        except RunnerError: pass  # Existing pipeline catches callback exceptions.
        return '# result', []
    runner.execute = execute
    transport.rpc.side_effect = RunnerError('RUNNER_TRANSPORT')
    runner.execute_task(task())
    publisher.publish.assert_not_called()
    assert runner.stopped.is_set()
