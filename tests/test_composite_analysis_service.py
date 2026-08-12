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


def test_composite_success_persists_then_sends_once(monkeypatch):
    monkeypatch.setattr(
        "src.services.composite_analysis_service.release_market_review_lock", lambda _token: None
    )
    service, pipeline, database = _service(results=[_result("600519"), _result("000858")])
    events = []

    result = service.run(
        CompositeAnalysisRequestSnapshot(("600519", "000858"), notify=True),
        task_id="abc123456",
        progress_callback=lambda **event: events.append(event),
    )

    assert result["status"] == "completed"
    assert result["history_id"] == 42
    database.save_analysis_history.assert_called_once()
    pipeline.notifier.send.assert_called_once()
    assert "大盘复盘" in pipeline.notifier.save_report_to_file.call_args.args[0]
    assert events[-1]["phase"] == "completed"


def test_stock_and_market_failures_still_create_partial_report(monkeypatch):
    monkeypatch.setattr(
        "src.services.composite_analysis_service.release_market_review_lock", lambda _token: None
    )
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
    assert "大盘复盘生成失败" in report
    database.save_analysis_history.assert_called_once()


def test_notification_failure_does_not_remove_saved_history(monkeypatch):
    monkeypatch.setattr(
        "src.services.composite_analysis_service.release_market_review_lock", lambda _token: None
    )
    service, _pipeline, database = _service(results=[_result("600519")], notify_result=False)

    result = service.run(
        CompositeAnalysisRequestSnapshot(("600519",), notify=True),
        task_id="abc123456",
        progress_callback=lambda **_event: None,
    )

    assert result["status"] == "partial"
    assert result["notification_status"] == "failed"
    database.save_analysis_history.assert_called_once()
