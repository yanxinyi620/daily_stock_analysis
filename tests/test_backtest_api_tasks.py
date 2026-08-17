from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from api.v1.endpoints import backtest as endpoint
from api.v1.schemas.backtest import BacktestRunRequest
from src.services.task_queue import TaskStatus


def _task(status=TaskStatus.PENDING, *, result=None, error=None):
    return SimpleNamespace(
        task_id="backtest-task-1",
        trace_id="backtest-task-1",
        status=status,
        progress=35,
        message="正在回测第 2/5 条历史分析",
        error=error,
        result=result,
        report_type="backtest_run",
    )


def test_start_backtest_task_submits_background_work() -> None:
    queue = MagicMock()
    queue.list_pending_tasks.return_value = []
    queue.submit_background_task.return_value = _task()

    with patch.object(endpoint, "get_task_queue", return_value=queue):
        accepted = endpoint.start_backtest_task(BacktestRunRequest(eval_window_days=1), MagicMock())

    assert accepted.task_id == "backtest-task-1"
    assert accepted.reused is False
    assert queue.submit_background_task.call_args.kwargs["report_type"] == "backtest_run"


def test_start_backtest_task_reuses_active_task() -> None:
    queue = MagicMock()
    queue.list_pending_tasks.return_value = [_task(TaskStatus.PROCESSING)]

    with patch.object(endpoint, "get_task_queue", return_value=queue):
        accepted = endpoint.start_backtest_task(BacktestRunRequest(force=True), MagicMock())

    assert accepted.task_id == "backtest-task-1"
    assert accepted.reused is True
    queue.submit_background_task.assert_not_called()


def test_start_backtest_task_marks_run_failed_when_submission_fails() -> None:
    queue = MagicMock()
    queue.list_pending_tasks.return_value = []
    queue.submit_background_task.side_effect = RuntimeError("executor unavailable")
    repo = MagicMock()

    with (
        patch.object(endpoint, "get_task_queue", return_value=queue),
        patch.object(endpoint, "BacktestRepository", return_value=repo),
        pytest.raises(RuntimeError, match="executor unavailable"),
    ):
        endpoint.start_backtest_task(BacktestRunRequest(force=True), MagicMock())

    repo.create_run.assert_called_once()
    run_id = repo.create_run.call_args.args[0].run_id
    repo.fail_run.assert_called_once_with(run_id, error="executor unavailable")


def test_get_backtest_task_returns_completed_result() -> None:
    result = {
        "processed": 2, "saved": 2, "completed": 1, "insufficient": 1,
        "errors": 0, "applied_eval_window_days": 1, "message": None,
        "diagnostics": {},
    }
    queue = MagicMock()
    queue.get_task.return_value = _task(TaskStatus.COMPLETED, result=result)

    with patch.object(endpoint, "get_task_queue", return_value=queue):
        status = endpoint.get_backtest_task_status("backtest-task-1")

    assert status.status == "completed"
    assert status.result is not None
    assert status.result.completed == 1


def test_get_backtest_task_rejects_missing_or_wrong_type() -> None:
    queue = MagicMock()
    queue.get_task.return_value = None
    with patch.object(endpoint, "get_task_queue", return_value=queue):
        with pytest.raises(HTTPException) as exc_info:
            endpoint.get_backtest_task_status("missing")
    assert exc_info.value.status_code == 404


def test_get_current_backtest_task_returns_active_task() -> None:
    queue = MagicMock()
    queue.list_pending_tasks.return_value = [_task(TaskStatus.PROCESSING)]

    with patch.object(endpoint, "get_task_queue", return_value=queue):
        status = endpoint.get_current_backtest_task()

    assert status is not None
    assert status.task_id == "backtest-task-1"
    assert status.status == "processing"


def test_get_current_backtest_task_returns_none_when_idle() -> None:
    queue = MagicMock()
    queue.list_pending_tasks.return_value = []

    with patch.object(endpoint, "get_task_queue", return_value=queue):
        status = endpoint.get_current_backtest_task()

    assert status is None
