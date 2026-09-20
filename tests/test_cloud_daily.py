"""Deterministic orchestration tests for the GitHub Actions daily entry point."""
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid5

import pytest

from src.services import cloud_daily
from src.services.cloud_runner import RunnerError, RunnerSettings

OWNER = '11111111-1111-4111-8111-111111111111'


def config():
    return SimpleNamespace(
        market_review_region='cn', cloud_runner_database_url='postgresql+psycopg://db',
        cloud_runner_id='github-actions-daily', cloud_runner_heartbeat_seconds=1,
        cloud_runner_online_seconds=60, cloud_runner_claim_seconds=30,
        cloud_runner_poll_seconds=3, log_dir='logs', supabase_url='https://example.supabase.co',
        supabase_secret_key='sb_secret_test', supabase_publish_user_id=OWNER,
        supabase_publish_timeout=3, enable_actions_dispatch=False,
    )


class FakeTransport:
    user_id = OWNER

    def __init__(self, _config):
        self.calls = []
        self.response = {'id': 'task', 'user_id': OWNER, 'status': 'succeeded'}

    def rpc(self, name, **params):
        self.calls.append((name, params))
        if name == 'cloud_submit_daily_execution':
            return self.response
        raise AssertionError(name)


class FakeRunner:
    instances = []
    default_execute_result = True

    def __init__(self, settings, transport, publisher, execute):
        self.session_id = '22222222-2222-4222-8222-222222222222'
        self.stopped = SimpleNamespace(is_set=lambda: False)
        self.transport = transport
        self.claimed = None
        self.execute_result = type(self).default_execute_result
        self.started = False
        self.closed = False
        self.execute_callback = execute
        FakeRunner.instances.append(self)

    def start_existing(self):
        self.started = True

    def _rpc(self, name, **params):
        self.transport.calls.append((name, params))
        if name == 'cloud_claim_execution':
            return self.claimed
        raise AssertionError(name)

    def execute_task(self, task):
        self.claimed = task
        return self.execute_result

    def close(self):
        self.closed = True


def patch_runtime(monkeypatch):
    FakeRunner.instances.clear()
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', FakeTransport)
    monkeypatch.setattr(cloud_daily, 'RunnerPublisher', lambda _config: object())
    monkeypatch.setattr(cloud_daily, 'CloudRunner', FakeRunner)
    monkeypatch.setattr(cloud_daily.RunnerSettings, 'from_config', classmethod(
        lambda _cls, _config: RunnerSettings('local-primary', 1, 60, 30, 3, __import__('pathlib').Path('logs'))
    ))
    monkeypatch.setattr('src.services.cloud_engine_storage.initialize_cloud_engine', lambda _url: None)


def test_non_trading_day_skips_before_registration(monkeypatch):
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: False)
    monkeypatch.setattr('src.services.cloud_engine_storage.initialize_cloud_engine', lambda _url: pytest.fail('must not initialize'))
    assert cloud_daily.run_cloud_daily(config(), now=datetime(2026, 9, 20)) == 0


def test_terminal_same_day_retry_does_not_start_runner_or_engine(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)
    assert cloud_daily.run_cloud_daily(config(), now=datetime(2026, 9, 21)) == 0
    assert FakeRunner.instances[0].started is False
    assert all(name != 'cloud_runner_register' for name, _ in transport.calls)


def test_pending_daily_task_attaches_existing_session_and_returns_success(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    transport.response = {'id': 'task', 'user_id': OWNER, 'status': 'pending',
                          'session_id': '22222222-2222-4222-8222-222222222222'}
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)
    runner_result = {'id': 'task', 'user_id': OWNER, 'task_type': 'composite_analysis', 'input_json': {
        'region': 'cn', 'stock_codes': ['000001'],
        'watchlist_snapshot': [{'market': 'CN', 'code': '000001', 'name': 'x', 'position': 0}],
    }}
    runner = FakeRunner.instances
    original_init = FakeRunner.__init__
    def init_and_claim(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.claimed = runner_result
    monkeypatch.setattr(FakeRunner, '__init__', init_and_claim)
    assert cloud_daily.run_cloud_daily(config(), now=datetime(2026, 9, 21)) == 0
    assert FakeRunner.instances[0].started is True
    assert FakeRunner.instances[0].closed is True
    assert FakeRunner.instances[0].session_id == '22222222-2222-4222-8222-222222222222'
    assert [name for name, _ in transport.calls] == ['cloud_submit_daily_execution', 'cloud_claim_execution']


def test_failed_daily_task_returns_failure_without_automatic_reanalysis(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    transport.response = {'id': 'task', 'user_id': OWNER, 'status': 'pending', 'session_id': '22222222-2222-4222-8222-222222222222'}
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)
    monkeypatch.setattr(FakeRunner, 'default_execute_result', False)
    result = cloud_daily.run_cloud_daily(config(), now=datetime(2026, 9, 21))
    assert result == 1


def test_foreign_active_session_is_not_stolen_or_stopped(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    transport.response = {
        'id': 'task', 'user_id': OWNER, 'status': 'running',
        'session_id': '99999999-9999-4999-8999-999999999999',
    }
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)

    assert cloud_daily.run_cloud_daily(config(), now=datetime(2026, 9, 21)) == 1
    runner = FakeRunner.instances[0]
    assert runner.started is False
    assert runner.closed is False
    assert [name for name, _ in transport.calls] == ['cloud_submit_daily_execution']


def test_failed_terminal_retry_returns_one_without_starting_or_stopping_runner(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    transport.response = {'id': 'task', 'user_id': OWNER, 'status': 'failed'}
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)

    assert cloud_daily.run_cloud_daily(config(), now=datetime(2026, 9, 21)) == 1
    runner = FakeRunner.instances[0]
    assert runner.started is False
    assert runner.closed is False


@pytest.mark.parametrize('region', ['CN', 'eu', '', None])
@pytest.mark.parametrize('force_run', [False, True])
def test_invalid_region_is_rejected_even_when_forced(monkeypatch, region, force_run):
    patch_runtime(monkeypatch)
    cfg = config()
    cfg.market_review_region = region
    with pytest.raises(RunnerError, match='INVALID_INPUT'):
        cloud_daily.run_cloud_daily(cfg, force_run=force_run,
                                    now=datetime(2026, 9, 21, tzinfo=timezone.utc))
    assert not FakeRunner.instances


def test_request_id_uses_market_local_date_not_runner_clock(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    transport.response = {'id': 'task', 'user_id': OWNER, 'status': 'succeeded'}
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)

    # 00:30 UTC is 08:30 in China, so the request must belong to 2026-09-21.
    now = datetime(2026, 9, 21, 0, 30, tzinfo=timezone.utc)
    assert cloud_daily.run_cloud_daily(config(), now=now) == 0
    request_id = next(params['p_request_id'] for name, params in transport.calls
                      if name == 'cloud_submit_daily_execution')
    expected = str(uuid5(NAMESPACE_URL, f'dsa-daily:{OWNER}:2026-09-21:cn'))
    assert request_id == expected


def test_claim_mismatch_returns_failure_and_closes_own_session(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    transport.response = {
        'id': 'task', 'user_id': OWNER, 'status': 'pending',
        'session_id': '22222222-2222-4222-8222-222222222222',
    }
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)

    def claim_mismatch(self, name, **params):
        self.transport.calls.append((name, params))
        if name == 'cloud_claim_execution':
            return {'id': 'different-task', 'user_id': OWNER}
        raise AssertionError(name)

    monkeypatch.setattr(FakeRunner, '_rpc', claim_mismatch)
    assert cloud_daily.run_cloud_daily(config(), now=datetime(2026, 9, 21)) == 1
    runner = FakeRunner.instances[0]
    assert runner.started is True
    assert runner.closed is True


def test_daily_runner_overrides_local_long_lease_settings(monkeypatch):
    patch_runtime(monkeypatch)
    monkeypatch.setattr(cloud_daily, '_trading_day', lambda _region, _date: True)
    transport = FakeTransport(config())
    transport.response = {'id': 'task', 'user_id': OWNER, 'status': 'succeeded'}
    monkeypatch.setattr(cloud_daily, 'RunnerTransport', lambda _config: transport)

    captured = {}
    original_init = FakeRunner.__init__

    def capture(self, settings, *args, **kwargs):
        captured['settings'] = settings
        original_init(self, settings, *args, **kwargs)

    monkeypatch.setattr(FakeRunner, '__init__', capture)
    cfg = config()
    cfg.cloud_runner_heartbeat_seconds = 60
    cfg.cloud_runner_online_seconds = 300
    cfg.cloud_runner_claim_seconds = 120
    assert cloud_daily.run_cloud_daily(cfg, now=datetime(2026, 9, 21)) == 0
    settings = captured['settings']
    assert settings.runner_id == cloud_daily.DAILY_RUNNER_ID
    assert settings.online_seconds == 60
    assert settings.claim_seconds == 30
    assert settings.heartbeat_seconds < settings.online_seconds / 2
