from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi.responses import JSONResponse

from api.v1.endpoints import analysis
from api.v1.schemas.analysis import CompositeAnalysisRequest
from src.services.task_queue import CompositeTaskConflictError


def _config():
    return SimpleNamespace(report_language="zh", market_review_region="cn")


def test_composite_endpoint_submits_frozen_request(monkeypatch):
    queue = SimpleNamespace(
        submit_composite_task=MagicMock(
            return_value=SimpleNamespace(
                task_id="task-1", trace_id="task-1", message="已提交"
            )
        ),
        update_composite_state=MagicMock(),
    )
    monkeypatch.setattr(analysis, "get_task_queue", lambda: queue)
    monkeypatch.setattr(analysis, "_try_acquire_market_review_lock", lambda _config: object())
    monkeypatch.setattr(
        "src.services.composite_analysis_service.CompositeAnalysisService",
        MagicMock(),
    )

    response = analysis.trigger_composite_analysis(
        CompositeAnalysisRequest(
            stock_codes=["600519", "600519.SH", "000858"],
            notify=False,
            region="cn",
        ),
        _config(),
    )

    assert response.task_id == "task-1"
    assert response.stock_codes == ["600519", "000858"]
    assert response.notify is False
    assert queue.submit_composite_task.call_args.kwargs["stock_codes"] == ["600519", "000858"]


def test_composite_endpoint_returns_structured_stock_conflict(monkeypatch):
    queue = SimpleNamespace(
        submit_composite_task=MagicMock(
            side_effect=CompositeTaskConflictError(
                stock_conflicts={"600519": "existing"}, composite_task_id=None
            )
        ),
        update_composite_state=MagicMock(),
    )
    monkeypatch.setattr(analysis, "get_task_queue", lambda: queue)
    monkeypatch.setattr(analysis, "_try_acquire_market_review_lock", lambda _config: object())
    monkeypatch.setattr(analysis, "_release_market_review_lock", MagicMock())
    monkeypatch.setattr(
        "src.services.composite_analysis_service.CompositeAnalysisService",
        MagicMock(),
    )

    response = analysis.trigger_composite_analysis(
        CompositeAnalysisRequest(stock_codes=["600519"]), _config()
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 409
    assert b'"error":"composite_task_conflict"' in response.body
    assert b'"600519":"existing"' in response.body


def test_composite_endpoint_rejects_market_lock_conflict(monkeypatch):
    monkeypatch.setattr(analysis, "_try_acquire_market_review_lock", lambda _config: None)

    response = analysis.trigger_composite_analysis(
        CompositeAnalysisRequest(stock_codes=["600519"]), _config()
    )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 409
    assert b'"market_review_conflict":true' in response.body
