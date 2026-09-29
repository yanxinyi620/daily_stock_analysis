"""The real CLI records safe evidence and keeps model output private."""
import json
from unittest.mock import Mock

from scripts.run_cloud_daily import main


def test_cleanup_entrypoint_never_runs_analysis(monkeypatch, tmp_path, capsys):
    from src.services import cloud_daily
    monkeypatch.setenv('LOG_DIR', str(tmp_path))
    monkeypatch.setattr('src.config.get_config', Mock(return_value=object()))
    cleanup = Mock()
    execute = Mock(side_effect=AssertionError('must not analyze'))
    monkeypatch.setattr(cloud_daily, 'reconcile_cloud_daily', cleanup)
    monkeypatch.setattr(cloud_daily, 'run_cloud_daily', execute)
    assert main(['--reconcile-only']) == 0
    cleanup.assert_called_once()
    execute.assert_not_called()
    body = json.loads((tmp_path / 'cloud-daily-cleanup.json').read_text())
    assert body['outcome'] == 'reconciled'
    assert body['exit_code'] == 0
    assert not (tmp_path / 'cloud-daily-diagnostics.json').exists()


def test_failure_retains_only_allowlisted_public_evidence(monkeypatch, tmp_path, capsys):
    from src.services import cloud_daily
    monkeypatch.setenv('LOG_DIR', str(tmp_path))
    monkeypatch.setattr('src.config.get_config', Mock(return_value=object()))
    monkeypatch.setattr(cloud_daily, 'run_cloud_daily', Mock(side_effect=RuntimeError('private-user-secret')))
    assert main([]) == 1
    public = (tmp_path / 'cloud-daily-diagnostics.json').read_text()
    assert 'private-user-secret' not in public + capsys.readouterr().out
    assert json.loads(public)['outcome'] == 'failed'
    assert 'private-user-secret' in (tmp_path / 'cloud-daily.log').read_text()
