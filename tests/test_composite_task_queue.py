# -*- coding: utf-8 -*-
"""Composite parent-task reservation tests."""

from concurrent.futures import Future

import pytest

from src.services.task_queue import (
    AnalysisTaskQueue,
    CompositeTaskConflictError,
    _dedupe_stock_code_key,
)


class HoldingExecutor:
    def __init__(self) -> None:
        self.submissions = []

    def submit(self, fn, *args):
        self.submissions.append((fn, args))
        return Future()

    def shutdown(self, wait=True, cancel_futures=False):
        return None


@pytest.fixture
def queue():
    original = AnalysisTaskQueue._instance
    AnalysisTaskQueue._instance = None
    created = AnalysisTaskQueue(max_workers=2)
    created._executor = HoldingExecutor()
    try:
        yield created
    finally:
        AnalysisTaskQueue._instance = original


def test_submit_composite_task_reserves_every_stock_atomically(queue) -> None:
    task = queue.submit_composite_task(
        lambda _task_id: {"ok": True},
        stock_codes=["600410", "600519.SH"],
        notify=True,
    )

    assert task.task_type == "composite_analysis"
    assert task.composite["stock_codes"] == ["600410", "600519"]
    assert queue._analyzing_stocks[_dedupe_stock_code_key("600410")] == task.task_id
    assert queue._analyzing_stocks[_dedupe_stock_code_key("600519")] == task.task_id
    assert queue._active_composite_task_id == task.task_id


def test_submit_composite_task_conflict_creates_nothing(queue) -> None:
    queue._analyzing_stocks[_dedupe_stock_code_key("600410")] = "existing-task"

    with pytest.raises(CompositeTaskConflictError) as exc_info:
        queue.submit_composite_task(
            lambda _task_id: {"ok": True},
            stock_codes=["600410", "600519"],
            notify=False,
        )

    assert exc_info.value.stock_conflicts == {"600410": "existing-task"}
    assert queue._active_composite_task_id is None
    assert list(queue._tasks) == []
    assert _dedupe_stock_code_key("600519") not in queue._analyzing_stocks
