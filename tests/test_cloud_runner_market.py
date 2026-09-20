"""Cloud market review keeps the legacy engine and requires durable history."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.services import cloud_runner
from tests.test_cloud_runner import setup_runner, USER, TASK


def market_task(region='cn'):
    return {'id': TASK, 'user_id': USER, 'task_type': 'market_review', 'input_json': {'region': region}}


def test_market_task_uses_same_saved_publication_retry(tmp_path):
    runner, transport, publisher, execute = setup_runner(tmp_path)
    runner.execute_task(market_task())
    execute.assert_called_once()
    publisher.publish_for_task.assert_called_once()
    assert transport.rpc.call_args.kwargs['p_report_id']


@pytest.mark.parametrize('input_json', [{'region': 'both'}, {'region': 'cn,us'}, {'region': None}, {'region': 'cn', 'stock_code': '000001'}, [], {}])
def test_market_input_rejected_before_engine(tmp_path, input_json):
    runner, _, publisher, execute = setup_runner(tmp_path)
    with pytest.raises(cloud_runner.RunnerError):
        runner.execute_task(dict(market_task(), input_json=input_json))
    execute.assert_not_called()
    publisher.publish_for_task.assert_not_called()


def test_market_adapter_reuses_real_review_and_persists_before_publish(monkeypatch, tmp_path):
    from src.config import Config
    from src.core import market_review
    from src.storage import DatabaseManager
    from src.services.run_diagnostics import record_llm_run
    config = Config(database_path=str(tmp_path / 'market.db'))
    db = DatabaseManager(config.get_db_url())
    notifier = Mock()
    pipeline = SimpleNamespace(db=db, notifier=notifier, analyzer=SimpleNamespace(last_model_used="test"), search_service=Mock())
    monkeypatch.setattr('src.core.market_review_runtime.build_market_review_runtime', Mock(return_value=(pipeline.notifier, pipeline.analyzer, pipeline.search_service)))
    def generate():
        record_llm_run(success=True, provider='test', model='test', call_type='market_review')
        return SimpleNamespace(report='# Market\n\nMarket signal: 61/100', market_light_snapshot=None,
                               structured_payload={'kind': 'market_review', 'region': 'cn', 'markdown_report': '# Market'})
    analyzer = Mock()
    analyzer.run_daily_review_with_snapshot.side_effect = generate
    monkeypatch.setattr(market_review, 'MarketAnalyzer', Mock(return_value=analyzer))
    markdown, results = cloud_runner.execute_market_review(config, market_task(), Mock())
    assert 'Market' in markdown and results[0]['code'] == 'MARKET'
    records = db.get_analysis_history(query_id=TASK, code='MARKET')
    assert len(records) == 1 and records[0].report_type == 'market_review'
    notifier.send.assert_not_called()
    notifier.save_report_to_file.assert_not_called()


@pytest.mark.parametrize('saved', [True, False])
def test_market_template_is_labelled_and_missing_history_fails(monkeypatch, saved):
    from src.core.market_review import MarketReviewRunResult
    db = Mock()
    db.get_analysis_history.return_value = [SimpleNamespace(report_type='market_review')] if saved else []
    pipeline = SimpleNamespace(db=db, notifier=Mock(), analyzer=SimpleNamespace(last_model_used="test"), search_service=Mock())
    monkeypatch.setattr('src.core.market_review_runtime.build_market_review_runtime', Mock(return_value=(pipeline.notifier, pipeline.analyzer, pipeline.search_service)))
    run = Mock(return_value=MarketReviewRunResult(report='# fallback', market_review_payload={'region': 'cn', 'markdown_report': '# fallback'}))
    monkeypatch.setattr('src.core.market_review.run_market_review', run)
    monkeypatch.setattr('src.storage.DatabaseManager.get_instance', Mock(return_value=db))
    config = SimpleNamespace(supabase_publish_enabled=True)
    if not saved:
        with pytest.raises(cloud_runner.RunnerError, match='HISTORY_NOT_SAVED'):
            cloud_runner.execute_market_review(config, market_task(), Mock())
    else:
        markdown, results = cloud_runner.execute_market_review(config, market_task(), Mock())
        assert '模板' in markdown and '模板' in results[0]['risk_warning']
        assert run.call_args.kwargs['send_notification'] is False
        assert run.call_args.kwargs['save_report_file'] is False
        assert run.call_args.kwargs['override_region'] == 'cn'
        assert config.supabase_publish_enabled is True


@pytest.mark.parametrize('report', [None, ''])
def test_empty_market_result_never_reads_history_or_publishes(monkeypatch, report):
    from src.core.market_review import MarketReviewRunResult
    from src.services.run_diagnostics import get_current_diagnostic_context
    monkeypatch.setattr('src.core.market_review_runtime.build_market_review_runtime', Mock(return_value=(Mock(), Mock(), None)))
    monkeypatch.setattr('src.core.market_review.run_market_review', Mock(return_value=None if report is None else MarketReviewRunResult(report=report)))
    db = Mock()
    monkeypatch.setattr('src.storage.DatabaseManager.get_instance', db)
    before = get_current_diagnostic_context()
    with pytest.raises(cloud_runner.RunnerError, match='ANALYSIS_FAILED'):
        cloud_runner.execute_market_review(SimpleNamespace(), market_task(), Mock())
    db.assert_not_called()
    assert get_current_diagnostic_context() is before
