"""Offline publication contract tests; no model or cloud credentials."""
import json
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

import pytest

from src.services.cloud_publisher import CloudPublisher, PublishError, build_envelope, publish_completed_report

USER = '11111111-1111-4111-8111-111111111111'


def config(**overrides):
    return SimpleNamespace(**dict({
        'supabase_publish_enabled': True, 'supabase_url': 'https://example.supabase.co',
        'supabase_secret_key': 'sb_secret_test', 'supabase_publish_user_id': USER,
        'supabase_publish_timeout': 10, 'enable_actions_dispatch': False,
    }, **overrides))


def envelope():
    return build_envelope(USER, 'stable-key', '# Report', [{'code': '000001', 'analysis_summary': 'summary'}],
                          generated_at='2026-09-14T00:00:00+00:00')


def client(responses):
    session = Mock()
    session.request.side_effect = [Mock(status_code=code, json=Mock(return_value=body)) for code, body in responses]
    return CloudPublisher(config(), session=session), session


def test_disabled_does_not_read_file_or_make_network_request(tmp_path):
    assert publish_completed_report(config(supabase_publish_enabled=False), [], None) is None


def test_missing_configuration_is_explicit():
    with pytest.raises(PublishError, match='SUPABASE'):
        CloudPublisher(config(supabase_secret_key=''))


def test_envelope_has_stable_user_scoped_id_and_excludes_debug_secrets():
    a = envelope()
    assert UUID(a['task_id'])
    assert a == envelope()
    b = build_envelope('22222222-2222-4222-8222-222222222222', 'stable-key', '# Report', [])
    assert b['task_id'] != a['task_id']
    sanitized = build_envelope(USER, 'key', 'md', [{'code': '000001', 'raw_response': 'secret', 'error_message': 'secret'}])
    assert 'secret' not in json.dumps(sanitized)


def test_upload_precedes_commit_and_keys_are_not_used_as_bearer_jwt():
    publisher, session = client([(200, 'publishing'), (200, {}), (200, 'succeeded')])
    assert publisher.publish(envelope()) == 'succeeded'
    calls = session.request.call_args_list
    assert '/rpc/cloud_begin_publish' in calls[0].args[1]
    assert '/storage/v1/object/analysis-reports/' in calls[1].args[1]
    assert '/rpc/cloud_complete_publish' in calls[2].args[1]
    assert calls[1].kwargs['headers']['x-upsert'] == 'false'
    assert 'Authorization' not in calls[1].kwargs['headers']
    assert calls[1].kwargs['allow_redirects'] is False


def test_completed_retry_skips_upload():
    publisher, session = client([(200, 'succeeded')])
    assert publisher.publish(envelope()) == 'succeeded'
    assert session.request.call_count == 1


def test_upload_failure_is_redacted_and_does_not_commit():
    publisher, session = client([(200, 'publishing'), (500, {'error': 'secret'}), (200, None)])
    with pytest.raises(PublishError) as exc:
        publisher.publish(envelope())
    assert 'secret' not in str(exc.value)
    assert '/rpc/cloud_fail_publish' in session.request.call_args_list[-1].args[1]
    assert not any('cloud_complete_publish' in call.args[1] for call in session.request.call_args_list)


def test_duplicate_object_can_finish_a_failed_publication():
    publisher, _ = client([(200, 'publishing'), (409, {'error': 'Duplicate'}), (200, 'succeeded')])
    assert publisher.publish(envelope()) == 'succeeded'


def test_user_mismatch_fails_before_network():
    publisher, session = client([])
    item = envelope()
    item['user_id'] = '22222222-2222-4222-8222-222222222222'
    with pytest.raises(PublishError):
        publisher.publish(item)
    session.request.assert_not_called()


def test_failed_publish_leaves_private_retry_package_without_rerunning_engine(tmp_path):
    report = tmp_path / 'report.md'
    report.write_text('# Report')
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(CloudPublisher, 'publish', Mock(side_effect=PublishError('upload failed')))
        with pytest.raises(PublishError):
            publish_completed_report(config(), [SimpleNamespace(to_dict=lambda: {'code': '000001'})], str(report))
    packages = list((tmp_path / '.cloud-publish').glob('*.json'))
    assert len(packages) == 1
    assert packages[0].stat().st_mode & 0o777 == 0o600
    assert json.loads(packages[0].read_text())['payload']['markdown'] == '# Report'


def test_pipeline_snapshot_does_not_read_overwritten_daily_report(tmp_path):
    report = tmp_path / 'report.md'
    report.write_text('# A')
    original_content = report.read_text()
    report.write_text('# B')  # a concurrent analysis replaced the daily output
    captured = []
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(CloudPublisher, 'publish', lambda self, package: captured.append(package) or 'succeeded')
        publish_completed_report(config(), [SimpleNamespace(to_dict=lambda: {'code': '000001'})],
                                 str(report), markdown=original_content)
    assert captured[0]['payload']['markdown'] == '# A'
    assert captured[0]['payload']['results'][0]['code'] == '000001'


def test_real_pipeline_publishes_snapshot_and_preserves_notifications(tmp_path):
    from tests.test_pipeline_single_stock_notify import TestPipelineSingleStockNotify, _make_result
    from src.core.pipeline import StockAnalysisPipeline
    from types import MethodType
    pipeline = TestPipelineSingleStockNotify._build_batch_pipeline()
    for key, value in vars(config()).items():
        setattr(pipeline.config, key, value)
    pipeline.config.single_stock_notify = False
    pipeline.process_single_stock = Mock(side_effect=lambda code, **kw: _make_result(code))
    pipeline._generate_aggregate_report = Mock(return_value='# A')
    pipeline._save_local_report = MethodType(StockAnalysisPipeline._save_local_report, pipeline)
    report = tmp_path / 'report.md'

    def save(content):
        report.write_text(content)
        return str(report)

    pipeline.notifier.save_report_to_file = save
    pipeline._send_notifications = Mock(side_effect=lambda *a, **kw: report.write_text('# B'))
    captured = []
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(CloudPublisher, 'publish', lambda self, package: captured.append(package) or 'succeeded')
        results = pipeline.run()
    assert len(results) == 2
    pipeline._send_notifications.assert_called_once()
    assert report.read_text() == '# B'
    assert captured[0]['payload']['markdown'] == '# A'


def test_real_pipeline_invalid_cloud_configuration_fails_before_analysis():
    from tests.test_pipeline_single_stock_notify import TestPipelineSingleStockNotify
    pipeline = TestPipelineSingleStockNotify._build_batch_pipeline()
    for key, value in vars(config(supabase_secret_key='')).items():
        setattr(pipeline.config, key, value)
    pipeline.process_single_stock = Mock()
    with pytest.raises(PublishError):
        pipeline.run()
    pipeline.process_single_stock.assert_not_called()


def test_transport_error_never_exposes_url_or_credentials():
    import requests
    publisher, session = client([])
    session.request.side_effect = requests.ConnectionError('sb_secret_test private@example.com')
    with pytest.raises(PublishError) as exc:
        publisher.publish(envelope())
    assert 'sb_secret_test' not in str(exc.value)
    assert 'private@example.com' not in str(exc.value)


def test_commit_timeout_can_be_retried_without_reuploading():
    import requests
    publisher, session = client([])
    session.request.side_effect = [
        Mock(status_code=200, json=lambda: 'publishing'), Mock(status_code=200, json=lambda: {}),
        requests.Timeout(), Mock(status_code=200, json=lambda: None),
        Mock(status_code=200, json=lambda: 'succeeded'),
    ]
    with pytest.raises(PublishError):
        publisher.publish(envelope())
    assert publisher.publish(envelope()) == 'succeeded'
    assert session.request.call_count == 5


def test_cleanup_defaults_to_dry_run_and_never_deletes_objects():
    item = envelope()
    path = f"{USER}/{item['task_id']}/{item['content_hash']}.md"
    publisher, session = client([(200, path)])
    publisher.cleanup(item)
    assert session.request.call_count == 1
    assert session.request.call_args.kwargs['json']['p_apply'] is False


def test_cleanup_requires_transactional_cancellation_before_object_delete():
    item = envelope()
    path = f"{USER}/{item['task_id']}/{item['content_hash']}.md"
    publisher, session = client([(200, path), (200, [])])
    publisher.cleanup(item, apply=True)
    assert session.request.call_args_list[0].kwargs['json']['p_apply'] is True
    assert session.request.call_args_list[1].args[0] == 'DELETE'
    assert session.request.call_args_list[1].kwargs['json'] == {'prefixes': [path]}
    publisher, session = client([(409, {})])
    with pytest.raises(PublishError):
        publisher.cleanup(item, apply=True)
    assert session.request.call_count == 1


def test_actions_dispatch_is_a_structured_configuration_error_even_when_publish_disabled():
    from src.config import Config
    issues = Config(enable_actions_dispatch=True, supabase_publish_enabled=False).validate_structured()
    assert any(issue.field == 'ENABLE_ACTIONS_DISPATCH' and issue.severity == 'error' for issue in issues)


def test_missing_cloud_credentials_are_reported_only_when_enabled():
    from src.config import Config
    enabled = Config(supabase_publish_enabled=True).validate_structured()
    disabled = Config(supabase_publish_enabled=False).validate_structured()
    assert any(issue.field == 'SUPABASE_PUBLISH_ENABLED' for issue in enabled)
    assert not any(issue.field == 'SUPABASE_PUBLISH_ENABLED' for issue in disabled)


def test_trusted_cloud_settings_are_not_in_web_schema_and_secret_is_masked_in_raw_config():
    from src.services.system_config_service import SystemConfigService
    manager = Mock()
    manager.read_config_map.return_value = {'SUPABASE_SECRET_KEY': 'sb_secret_never_return_this'}
    service = SystemConfigService(manager=manager)
    assert not any(item['key'].startswith('SUPABASE_') for item in service.get_config()['items'])
    raw = service.get_config(include_schema=False)['items']
    secret = next(item for item in raw if item['key'] == 'SUPABASE_SECRET_KEY')
    assert secret['value'] == '******'
    assert secret['is_masked'] is True
