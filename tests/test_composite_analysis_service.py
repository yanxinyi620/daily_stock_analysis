from types import SimpleNamespace
from unittest.mock import MagicMock

from src.analyzer import AnalysisResult
from src.services.composite_analysis_service import (
    CompositeAnalysisRequestSnapshot,
    CompositeAnalysisService,
)


def _result(code: str) -> AnalysisResult:
    return AnalysisResult(
        code=code,
        name=code,
        sentiment_score=60,
        trend_prediction="震荡",
        operation_advice="观望",
        analysis_summary="摘要",
        model_used="codex_cli",
    )


class FakePipeline:
    def __init__(self, results, failures, send_result=True):
        self.results = results
        self.failures = failures
        self.notifier = SimpleNamespace(
            generate_aggregate_report=MagicMock(return_value="个股报告"),
            save_report_to_file=MagicMock(return_value="/tmp/composite.md"),
            send=MagicMock(return_value=send_result),
        )

    def run(self, stock_codes, batch_item_callback, **_kwargs):
        completed = 0
        by_code = {item.code: item for item in self.results}
        for code in stock_codes:
            completed += 1
            result = by_code.get(code)
            batch_item_callback(
                code,
                "completed" if result else "failed",
                result,
                None if result else self.failures.get(code, "失败"),
                completed,
                len(stock_codes),
            )
        return self.results


def _service(*, results, failures=None, notify_result=True, market_error=False):
    pipeline = FakePipeline(results, failures or {}, notify_result)
    database = SimpleNamespace(save_analysis_history=MagicMock(return_value=42))
    review_runner = MagicMock(
        side_effect=RuntimeError("市场失败") if market_error else None,
        return_value=SimpleNamespace(report="大盘报告"),
    )
    service = CompositeAnalysisService(
        SimpleNamespace(),
        pipeline_factory=MagicMock(return_value=pipeline),
        market_runtime_factory=MagicMock(return_value=(object(), object(), object())),
        market_review_runner=review_runner,
        database=database,
    )
    return service, pipeline, database


def test_composite_success_persists_then_sends_once():
    service, pipeline, database = _service(results=[_result("600519"), _result("000858")])
    events = []

    result = service.run(
        CompositeAnalysisRequestSnapshot(("600519", "000858"), notify=True),
        task_id="abc123456",
        progress_callback=lambda **event: events.append(event),
    )

    assert result["status"] == "completed"
    assert result["history_id"] == 42
    market_call = service.market_review_runner.call_args.kwargs
    assert market_call["persist_history"] is True
    assert market_call["send_notification"] is False
    assert market_call["query_id"] == "abc123456"
    assert market_call["trigger_source"] == "api_composite"
    database.save_analysis_history.assert_called_once()
    assert database.save_analysis_history.call_args.args[0].model_used == "codex_cli"
    assert database.save_analysis_history.call_args.kwargs["context_snapshot"]["notification_requested"] is True
    pipeline.notifier.send.assert_called_once()
    assert "大盘复盘" in pipeline.notifier.save_report_to_file.call_args.args[0]
    assert events[-1]["phase"] == "completed"


def test_stock_and_market_failures_still_create_partial_report():
    service, pipeline, database = _service(
        results=[_result("600519")], failures={"000858": "API key=secret\n失败"}, market_error=True
    )

    result = service.run(
        CompositeAnalysisRequestSnapshot(("600519", "000858"), notify=False),
        task_id="abc123456",
        progress_callback=lambda **_event: None,
    )

    assert result["status"] == "partial"
    assert result["stock_failed"] == 1
    assert result["market_review_status"] == "failed"
    pipeline.notifier.send.assert_not_called()
    report = pipeline.notifier.save_report_to_file.call_args.args[0]
    assert "000858" in report
    assert "secret" not in report
    assert "大盘复盘生成失败" in report
    database.save_analysis_history.assert_called_once()


def test_notification_failure_does_not_remove_saved_history():
    service, _pipeline, database = _service(results=[_result("600519")], notify_result=False)

    result = service.run(
        CompositeAnalysisRequestSnapshot(("600519",), notify=True),
        task_id="abc123456",
        progress_callback=lambda **_event: None,
    )

    assert result["status"] == "partial"
    assert result["notification_status"] == "failed"
    database.save_analysis_history.assert_called_once()


def test_no_valid_content_fails_without_history():
    service, pipeline, database = _service(results=[], failures={"600519": "模型失败"}, market_error=True)

    try:
        service.run(
            CompositeAnalysisRequestSnapshot(("600519",), notify=True),
            task_id="abc123456",
            progress_callback=lambda **_event: None,
        )
    except RuntimeError as exc:
        assert "未生成有效内容" in str(exc)
    else:
        raise AssertionError("expected no-valid-content failure")

    database.save_analysis_history.assert_not_called()
    pipeline.notifier.send.assert_not_called()


def test_cancellation_after_stock_stage_skips_market_report_and_notification():
    service, pipeline, database = _service(results=[_result("600519")])

    result = service.run(
        CompositeAnalysisRequestSnapshot(("600519",), notify=True),
        task_id="abc123456",
        progress_callback=lambda **_event: None,
        cancel_requested=lambda: True,
    )

    assert result["status"] == "cancelled"
    database.save_analysis_history.assert_not_called()
    pipeline.notifier.send.assert_not_called()


def test_cloud_mode_omits_files_and_marks_missing_component_history_partial():
    service, pipeline, database = _service(results=[_result('600519'), _result('000858')])
    pipeline.results[0].query_id = 'saved-stock'
    pipeline.results[1].query_id = 'lost-stock'
    database.get_analysis_history = MagicMock(side_effect=lambda **kw: [SimpleNamespace(report_type='market_review')] if kw['code']=='MARKET' else ([object()] if kw['query_id']=='saved-stock' else []))
    result = service.run(CompositeAnalysisRequestSnapshot(('600519','000858'), notify=False),
                         task_id='cloud', progress_callback=lambda **_: None,
                         save_report_file=False, require_persisted_components=True)
    assert result['status'] == 'partial' and result['stock_completed']==1 and result['stock_failed']==1
    pipeline.notifier.save_report_to_file.assert_not_called()
    pipeline.notifier.send.assert_not_called()
    saved = database.save_analysis_history.call_args
    assert '部分完成' in saved.kwargs['news_content'] and '模板' in saved.kwargs['news_content']
    assert saved.kwargs['context_snapshot']['failed_stocks']==['000858']
    assert result['report_path']==''


def test_cloud_missing_market_history_is_failure_not_success():
    service, pipeline, database = _service(results=[_result('600519')])
    pipeline.results[0].query_id='saved-stock'
    database.get_analysis_history=MagicMock(side_effect=lambda **kw: [] if kw['code']=='MARKET' else [object()])
    result=service.run(CompositeAnalysisRequestSnapshot(('600519',),notify=False),task_id='cloud',
                       progress_callback=lambda **_:None,save_report_file=False,require_persisted_components=True)
    assert result['status']=='partial' and result['market_review_status']=='failed'
    assert '部分完成' in database.save_analysis_history.call_args.kwargs['news_content']


def test_cloud_history_query_failure_is_not_swallowed_by_progress_callback():
    import pytest
    service, pipeline, database = _service(results=[_result('600519')])
    pipeline.results[0].query_id = 'saved-stock'
    database.get_analysis_history = MagicMock(side_effect=RuntimeError('database unavailable'))
    with pytest.raises(RuntimeError, match='database unavailable'):
        service.run(CompositeAnalysisRequestSnapshot(('600519',),notify=False),task_id='cloud',
                    progress_callback=lambda **_:None,save_report_file=False,require_persisted_components=True)
    database.save_analysis_history.assert_not_called()
    service.market_review_runner.assert_not_called()
