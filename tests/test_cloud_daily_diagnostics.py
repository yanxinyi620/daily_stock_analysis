"""Public diagnostic artifacts must never copy raw exceptions or business data."""
import json
from unittest.mock import Mock

import pytest

from src.services.cloud_daily_diagnostics import DailyDiagnostics
from src.services.cloud_runner import RunnerError
from tests.test_cloud_runner import setup_runner, task


def test_diagnostics_is_atomic_bounded_and_uses_only_fixed_fields(tmp_path):
    path = tmp_path / 'daily.json'
    diag = DailyDiagnostics(path)
    for _ in range(200):
        diag.record('analysis')
    diag.record('publish', error_code='PUBLISH_FAILED',
                error=RuntimeError('https://user:password@host/?token=secret'))
    diag.finish(1)
    body = json.loads(path.read_text())
    assert body['outcome'] == 'failed'
    assert body['exit_code'] == 1
    assert len(body['events']) <= 100
    assert body['duration_seconds'] >= 0
    assert body['events'][-2]['error_type'] == 'unexpected'
    assert not any(secret in path.read_text() for secret in ['password', 'token', 'secret', 'https://'])
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(ValueError):
        diag.record('secret-stage')
    with pytest.raises(ValueError):
        diag.record('analysis', error_code='secret-error')


def test_runner_failure_preserves_stage_without_exception_body(tmp_path):
    runner, _, _, _ = setup_runner(tmp_path, Mock(side_effect=RuntimeError('private model payload')))
    diag = DailyDiagnostics(tmp_path / 'diagnostics' / 'daily.json')
    runner.diagnostics = diag
    assert runner.execute_task(task()) is False
    diag.finish(1)
    events = diag.snapshot()['events']
    assert any(e['stage'] == 'analysis' and e.get('error_code') == 'ANALYSIS_FAILED' for e in events)
    assert 'private model payload' not in json.dumps(diag.snapshot())


def test_transport_preserves_http_status_but_never_response_body():
    from src.services.cloud_runner import RunnerTransport
    from src.services.cloud_publisher import PublishError
    from tests.test_cloud_daily import config
    transport = RunnerTransport(config())
    transport._request = Mock(side_effect=PublishError('publish HTTP 503; retry the saved package'))
    with pytest.raises(RunnerError) as caught:
        transport.rpc('cloud_runner_snapshot')
    assert caught.value.http_status == 503
    assert str(caught.value) == 'RUNNER_TRANSPORT'


def test_heartbeat_failure_is_durable_and_stops_new_work(tmp_path):
    runner, transport, _, _ = setup_runner(tmp_path)
    runner.diagnostics = DailyDiagnostics(tmp_path / 'diagnostics' / 'daily.json')
    runner.stopped.wait = Mock(side_effect=[False, True])
    transport.rpc.side_effect = RunnerError('RUNNER_TRANSPORT', http_status=503)
    runner._heartbeat()
    assert runner.stopped.is_set()
    event = runner.diagnostics.snapshot()['events'][-1]
    assert event['stage'] == 'heartbeat'
    assert event['error_code'] == 'RUNNER_TRANSPORT'
    assert event['http_status'] == 503


def test_evidence_io_failure_does_not_change_success(monkeypatch, tmp_path):
    diag = DailyDiagnostics(tmp_path / 'daily.json')
    monkeypatch.setattr(diag, '_write', Mock(side_effect=OSError('private path')))
    runner, transport, _, _ = setup_runner(tmp_path)
    runner.diagnostics = diag
    assert runner.execute_task(task()) is True
    runner.close()
    diag.finish(0)
    assert diag.snapshot()['outcome'] == 'completed'
    assert transport.rpc.call_args.args[0] == 'cloud_runner_stop'


def test_partial_report_is_distinct_from_full_success(tmp_path):
    from tests.test_cloud_runner_composite import composite_task, outcome
    execute = Mock(return_value=('# partial', [{'code': 'COMPOSITE'}], outcome()))
    runner, _, _, _ = setup_runner(tmp_path, execute)
    runner.diagnostics = DailyDiagnostics(tmp_path / 'diagnostics' / 'daily.json')
    assert runner.execute_task(composite_task()) is True
    runner.diagnostics.finish(0)
    assert runner.diagnostics.snapshot()['outcome'] == 'partial'
    execute.assert_called_once()
