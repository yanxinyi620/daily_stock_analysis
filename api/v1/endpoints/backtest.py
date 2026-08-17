# -*- coding: utf-8 -*-
"""Backtest endpoints."""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import date
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_database_manager
from api.v1.schemas.backtest import (
    BacktestRunRequest,
    BacktestRunResponse,
    BacktestTaskAccepted,
    BacktestTaskStatus,
    BacktestRunHistoryItem,
    BacktestRunHistoryResponse,
    BacktestResultItem,
    BacktestResultsResponse,
    PerformanceMetrics,
)
from api.v1.schemas.common import ErrorResponse
from src.services.backtest_service import BacktestService
from src.repositories.backtest_repo import BacktestRepository
from src.services.run_diagnostics import sanitize_diagnostic_text
from src.services.task_queue import TaskStatus, get_task_queue
from src.storage import BacktestRun, DatabaseManager

logger = logging.getLogger(__name__)

router = APIRouter()
_backtest_submit_lock = threading.Lock()

BacktestAnalysisPhaseQuery = Literal["premarket", "intraday", "postmarket", "unknown"]


def _serialize_backtest_task(task) -> BacktestTaskStatus:
    result = task.result if task.status == TaskStatus.COMPLETED and isinstance(task.result, dict) else None
    return BacktestTaskStatus(
        task_id=task.task_id,
        status=task.status.value if isinstance(task.status, TaskStatus) else str(task.status),
        progress=task.progress,
        message=task.message,
        error="回测任务执行失败" if task.status == TaskStatus.FAILED else None,
        result=BacktestRunResponse(**result) if result is not None else None,
    )


def _validate_analysis_date_range(
    analysis_date_from: Optional[date],
    analysis_date_to: Optional[date],
) -> None:
    if analysis_date_from and analysis_date_to and analysis_date_from > analysis_date_to:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_params",
                "message": "analysis_date_from cannot be after analysis_date_to",
            },
        )


@router.post(
    "/run",
    response_model=BacktestRunResponse,
    responses={
        200: {"description": "回测执行完成"},
        400: {"description": "请求参数错误", "model": ErrorResponse},
        500: {"description": "服务器错误", "model": ErrorResponse},
    },
    summary="触发回测",
    description="对历史分析记录进行回测评估，并写入 backtest_results/backtest_summaries",
)
def run_backtest(
    request: BacktestRunRequest,
    db_manager: DatabaseManager = Depends(get_database_manager),
) -> BacktestRunResponse:
    _validate_analysis_date_range(request.analysis_date_from, request.analysis_date_to)
    run_id = uuid.uuid4().hex
    repo = BacktestRepository(db_manager)
    repo.create_run(_build_run_record(run_id, None, "api_sync", request))
    repo.mark_run_processing(run_id)
    try:
        service = BacktestService(db_manager)
        stats = service.run_backtest(
            code=request.code,
            force=request.force,
            eval_window_days=request.eval_window_days,
            min_age_days=request.min_age_days,
            analysis_date_from=request.analysis_date_from,
            analysis_date_to=request.analysis_date_to,
            limit=request.limit,
        )
        repo.complete_run(run_id, status="partial" if stats.get("errors", 0) else "completed", stats=stats)
        return BacktestRunResponse(**stats)
    except ValueError as exc:
        repo.fail_run(run_id, error=sanitize_diagnostic_text(str(exc)))
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_params", "message": str(exc)},
        )
    except HTTPException:
        raise
    except Exception as exc:
        repo.fail_run(run_id, error=sanitize_diagnostic_text(str(exc)))
        logger.error(f"回测执行失败: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"回测执行失败: {str(exc)}"},
        )


@router.post("/tasks", status_code=202, response_model=BacktestTaskAccepted)
def start_backtest_task(
    request: BacktestRunRequest,
    db_manager: DatabaseManager = Depends(get_database_manager),
) -> BacktestTaskAccepted:
    """Submit a long-running backtest and return immediately."""
    _validate_analysis_date_range(request.analysis_date_from, request.analysis_date_to)
    queue = get_task_queue()
    with _backtest_submit_lock:
        active = next(
            (
                task for task in queue.list_pending_tasks()
                if task.report_type == "backtest_run"
            ),
            None,
        )
        if active is not None:
            return BacktestTaskAccepted(
                task_id=active.task_id,
                status=active.status.value if isinstance(active.status, TaskStatus) else str(active.status),
                message=active.message,
                reused=True,
            )

        task_id = uuid.uuid4().hex
        repo = BacktestRepository(db_manager)
        repo.create_run(_build_run_record(task_id, task_id, "web", request))

        def run_task() -> Dict[str, Any]:
            repo.mark_run_processing(task_id)
            try:
                stats = BacktestService(db_manager).run_backtest(
                    code=request.code,
                    force=request.force,
                    eval_window_days=request.eval_window_days,
                    min_age_days=request.min_age_days,
                    analysis_date_from=request.analysis_date_from,
                    analysis_date_to=request.analysis_date_to,
                    limit=request.limit,
                    progress_callback=lambda progress, message: queue.update_task_progress(
                        task_id, progress, message
                    ),
                )
            except Exception as exc:
                repo.fail_run(task_id, error=sanitize_diagnostic_text(str(exc)))
                raise
            repo.complete_run(
                task_id,
                status="partial" if stats.get("errors", 0) else "completed",
                stats=stats,
            )
            return stats

        try:
            task = queue.submit_background_task(
                run_task,
                stock_code="BACKTEST",
                stock_name="历史分析回测",
                report_type="backtest_run",
                message="回测任务已提交",
                task_id=task_id,
                trace_id=task_id,
            )
        except Exception as exc:
            repo.fail_run(task_id, error=sanitize_diagnostic_text(str(exc)))
            raise
        return BacktestTaskAccepted(
            task_id=task.task_id,
            status=task.status.value if isinstance(task.status, TaskStatus) else str(task.status),
            message=task.message,
            reused=False,
        )


def _build_run_record(
    run_id: str,
    task_id: Optional[str],
    source: str,
    request: BacktestRunRequest,
) -> BacktestRun:
    return BacktestRun(
        run_id=run_id,
        task_id=task_id,
        source=source,
        status="pending",
        code=request.code,
        force=request.force,
        eval_window_days=request.eval_window_days,
        min_age_days=request.min_age_days,
        analysis_date_from=request.analysis_date_from,
        analysis_date_to=request.analysis_date_to,
        result_limit=request.limit,
    )


@router.get("/runs", response_model=BacktestRunHistoryResponse)
def get_backtest_runs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db_manager: DatabaseManager = Depends(get_database_manager),
) -> BacktestRunHistoryResponse:
    rows, total = BacktestRepository(db_manager).list_runs(offset=(page - 1) * limit, limit=limit)
    items = []
    for row in rows:
        try:
            diagnostics = json.loads(row.diagnostics_json) if row.diagnostics_json else {}
        except (TypeError, ValueError):
            diagnostics = {}
        items.append(BacktestRunHistoryItem(
            run_id=row.run_id,
            task_id=row.task_id,
            source=row.source,
            status=row.status,
            code=row.code,
            force=bool(row.force),
            eval_window_days=row.eval_window_days,
            min_age_days=row.min_age_days,
            analysis_date_from=row.analysis_date_from,
            analysis_date_to=row.analysis_date_to,
            limit=row.result_limit,
            created_at=row.created_at,
            started_at=row.started_at,
            completed_at=row.completed_at,
            processed=row.processed_count,
            saved=row.saved_count,
            completed=row.completed_count,
            insufficient=row.insufficient_count,
            errors=row.errors_count,
            message=row.message,
            diagnostics=diagnostics if isinstance(diagnostics, dict) else {},
            error=row.error,
        ))
    return BacktestRunHistoryResponse(total=total, page=page, limit=limit, items=items)


@router.get("/tasks/current", response_model=Optional[BacktestTaskStatus])
def get_current_backtest_task() -> Optional[BacktestTaskStatus]:
    task = next(
        (
            item for item in get_task_queue().list_pending_tasks()
            if item.report_type == "backtest_run"
        ),
        None,
    )
    return _serialize_backtest_task(task) if task is not None else None


@router.get("/tasks/{task_id}", response_model=BacktestTaskStatus)
def get_backtest_task_status(task_id: str) -> BacktestTaskStatus:
    task = get_task_queue().get_task(task_id)
    if task is None or task.report_type != "backtest_run":
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "回测任务不存在或已过期"})
    return _serialize_backtest_task(task)


@router.get(
    "/results",
    response_model=BacktestResultsResponse,
    responses={
        200: {"description": "回测结果列表"},
        400: {"description": "请求参数错误", "model": ErrorResponse},
        500: {"description": "服务器错误", "model": ErrorResponse},
    },
    summary="获取回测结果",
    description="分页获取回测结果，支持按股票代码过滤",
)
def get_backtest_results(
    code: Optional[str] = Query(None, description="股票代码筛选"),
    eval_window_days: Optional[int] = Query(None, ge=1, le=120, description="评估窗口过滤"),
    analysis_date_from: Optional[date] = Query(None, description="分析日期起始（含）"),
    analysis_date_to: Optional[date] = Query(None, description="分析日期结束（含）"),
    analysis_phase: Optional[BacktestAnalysisPhaseQuery] = Query(None, description="分析阶段过滤：premarket/intraday/postmarket/unknown"),
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(20, ge=1, le=200, description="每页数量"),
    db_manager: DatabaseManager = Depends(get_database_manager),
) -> BacktestResultsResponse:
    try:
        _validate_analysis_date_range(analysis_date_from, analysis_date_to)
        service = BacktestService(db_manager)
        data = service.get_recent_evaluations(
            code=code,
            eval_window_days=eval_window_days,
            limit=limit,
            page=page,
            analysis_date_from=analysis_date_from,
            analysis_date_to=analysis_date_to,
            analysis_phase=analysis_phase,
        )
        items = [BacktestResultItem(**item) for item in data.get("items", [])]
        return BacktestResultsResponse(
            total=int(data.get("total", 0)),
            page=page,
            limit=limit,
            items=items,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_params", "message": str(exc)},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"查询回测结果失败: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"查询回测结果失败: {str(exc)}"},
        )


@router.get(
    "/performance",
    response_model=PerformanceMetrics,
    responses={
        200: {"description": "整体回测表现"},
        400: {"description": "请求参数错误", "model": ErrorResponse},
        404: {"description": "无回测汇总", "model": ErrorResponse},
        500: {"description": "服务器错误", "model": ErrorResponse},
    },
    summary="获取整体回测表现",
)
def get_overall_performance(
    eval_window_days: Optional[int] = Query(None, ge=1, le=120, description="评估窗口过滤"),
    analysis_date_from: Optional[date] = Query(None, description="分析日期起始（含）"),
    analysis_date_to: Optional[date] = Query(None, description="分析日期结束（含）"),
    analysis_phase: Optional[BacktestAnalysisPhaseQuery] = Query(None, description="分析阶段过滤：premarket/intraday/postmarket/unknown"),
    db_manager: DatabaseManager = Depends(get_database_manager),
) -> PerformanceMetrics:
    try:
        _validate_analysis_date_range(analysis_date_from, analysis_date_to)
        service = BacktestService(db_manager)
        summary = service.get_summary(
            scope="overall",
            code=None,
            eval_window_days=eval_window_days,
            analysis_date_from=analysis_date_from,
            analysis_date_to=analysis_date_to,
            analysis_phase=analysis_phase,
        )
        if summary is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": "未找到整体回测汇总"},
            )
        return PerformanceMetrics(**summary)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_params", "message": str(exc)},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"查询整体表现失败: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"查询整体表现失败: {str(exc)}"},
        )


@router.get(
    "/performance/{code}",
    response_model=PerformanceMetrics,
    responses={
        200: {"description": "单股回测表现"},
        400: {"description": "请求参数错误", "model": ErrorResponse},
        404: {"description": "无回测汇总", "model": ErrorResponse},
        500: {"description": "服务器错误", "model": ErrorResponse},
    },
    summary="获取单股回测表现",
)
def get_stock_performance(
    code: str,
    eval_window_days: Optional[int] = Query(None, ge=1, le=120, description="评估窗口过滤"),
    analysis_date_from: Optional[date] = Query(None, description="分析日期起始（含）"),
    analysis_date_to: Optional[date] = Query(None, description="分析日期结束（含）"),
    analysis_phase: Optional[BacktestAnalysisPhaseQuery] = Query(None, description="分析阶段过滤：premarket/intraday/postmarket/unknown"),
    db_manager: DatabaseManager = Depends(get_database_manager),
) -> PerformanceMetrics:
    try:
        _validate_analysis_date_range(analysis_date_from, analysis_date_to)
        service = BacktestService(db_manager)
        summary = service.get_summary(
            scope="stock",
            code=code,
            eval_window_days=eval_window_days,
            analysis_date_from=analysis_date_from,
            analysis_date_to=analysis_date_to,
            analysis_phase=analysis_phase,
        )
        if summary is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"未找到 {code} 的回测汇总"},
            )
        return PerformanceMetrics(**summary)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_params", "message": str(exc)},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"查询单股表现失败: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"查询单股表现失败: {str(exc)}"},
        )
