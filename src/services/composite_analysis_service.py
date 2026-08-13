"""Composite stock and market analysis orchestration for the Web API."""

from __future__ import annotations

import copy
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Sequence

from src.analyzer import AnalysisResult
from src.config import Config
from src.core.market_review import run_market_review
from src.core.market_review_runtime import build_market_review_runtime
from src.core.pipeline import StockAnalysisPipeline
from src.enums import ReportType
from src.storage import DatabaseManager
from src.services.run_diagnostics import sanitize_diagnostic_text

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CompositeAnalysisRequestSnapshot:
    stock_codes: tuple[str, ...]
    notify: bool
    report_type: str = "full"
    report_language: str = "zh"
    skills: tuple[str, ...] = ()
    region: str = "cn"


@dataclass
class CompositeRunResult:
    status: str
    history_id: int
    report_path: str
    stock_completed: int
    stock_failed: int
    market_review_status: str
    notification_status: str

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


class CompositeAnalysisService:
    """Run a frozen watchlist snapshot and produce one durable aggregate report."""

    def __init__(
        self,
        config: Config,
        *,
        pipeline_factory: Callable[..., StockAnalysisPipeline] = StockAnalysisPipeline,
        market_runtime_factory: Callable[..., tuple[Any, Any, Any]] = build_market_review_runtime,
        market_review_runner: Callable[..., Any] = run_market_review,
        database: Optional[DatabaseManager] = None,
    ) -> None:
        self.config = config
        self.pipeline_factory = pipeline_factory
        self.market_runtime_factory = market_runtime_factory
        self.market_review_runner = market_review_runner
        self.database = database or DatabaseManager.get_instance()

    def run(
        self,
        snapshot: CompositeAnalysisRequestSnapshot,
        *,
        task_id: str,
        progress_callback: Callable[..., Any],
        market_lock_token: Any = None,
        cancel_requested: Callable[[], bool] = lambda: False,
    ) -> Dict[str, Any]:
        scoped_config = copy.copy(self.config)
        scoped_config.report_type = snapshot.report_type
        scoped_config.report_language = snapshot.report_language
        scoped_config.market_review_region = snapshot.region
        pipeline = self.pipeline_factory(
            config=scoped_config,
            query_id=task_id,
            trace_id=task_id,
            query_source="api_composite",
            analysis_skills=list(snapshot.skills),
            daily_market_context_allow_generate=False,
        )
        failures: Dict[str, str] = {}

        def on_stock(
            code: str,
            status: str,
            _result: Optional[AnalysisResult],
            error: Optional[str],
            completed: int,
            total: int,
        ) -> None:
            if status != "completed":
                failures[code] = self._safe_error(error)
            progress_callback(
                phase="stocks",
                progress=5 + int(55 * completed / max(total, 1)),
                patch={
                    "stock_summary": {
                        "total": total,
                        "completed": completed - len(failures),
                        "failed": len(failures),
                        "current_stock_code": code,
                    }
                },
                message=f"个股分析进度 {completed}/{total}",
            )

        progress_callback(phase="stocks", progress=5, message="开始分析自选股")
        results = pipeline.run(
            stock_codes=list(snapshot.stock_codes),
            send_notification=False,
            merge_notification=True,
            batch_item_callback=on_stock,
        )
        successful_codes = {result.code for result in results}
        for code in snapshot.stock_codes:
            if code not in successful_codes and code not in failures:
                failures[code] = "分析未返回有效结果"

        if cancel_requested():
            return {"status": "cancelled", "stock_completed": len(results), "stock_failed": len(failures)}

        market_report = ""
        market_status = "completed"
        progress_callback(
            phase="market_review",
            progress=65,
            patch={"market_review": {"status": "processing"}},
            message="正在生成大盘复盘",
        )
        try:
            notifier, analyzer, search_service = self.market_runtime_factory(scoped_config)
            review = self.market_review_runner(
                notifier=notifier,
                analyzer=analyzer,
                search_service=search_service,
                config=scoped_config,
                send_notification=False,
                merge_notification=True,
                override_region=snapshot.region,
                query_id=task_id,
                return_structured=True,
                save_report_file=False,
                persist_history=False,
                trigger_source="api_composite",
            )
            market_report = str(getattr(review, "report", review) or "").strip()
            if not market_report:
                raise RuntimeError("大盘复盘未返回报告")
        except Exception as exc:
            market_status = "failed"
            market_report = f"> 大盘复盘生成失败：{self._safe_error(exc)}"
            logger.warning("组合任务大盘复盘失败: %s", exc)
        progress_callback(
            phase="report",
            progress=82,
            patch={"market_review": {"status": market_status}, "report": {"status": "processing"}},
            message="正在生成综合报告",
        )
        if cancel_requested():
            return {"status": "cancelled", "stock_completed": len(results), "stock_failed": len(failures)}
        if not results and market_status == "failed":
            raise RuntimeError("个股分析与大盘复盘均未生成有效内容")
        stock_report = (
            pipeline.notifier.generate_aggregate_report(
                results, ReportType.from_str(snapshot.report_type)
            )
            if results
            else "> 本次没有成功生成个股报告。"
        )
        report = self._compose_report(snapshot, stock_report, market_report, failures)
        filename = f"composite_analysis_{datetime.now():%Y%m%d}_{task_id[:8]}.md"
        report_path = pipeline.notifier.save_report_to_file(report, filename=filename)
        synthetic = AnalysisResult(
            code="COMPOSITE",
            name="今日综合分析",
            sentiment_score=self._average_score(results),
            trend_prediction="综合",
            operation_advice="查看综合报告",
            analysis_summary=f"{len(results)} 支股票完成，{len(failures)} 支失败；大盘复盘{market_status}",
            raw_response=report,
            report_language=snapshot.report_language,
        )
        history_id = self.database.save_analysis_history(
            synthetic,
            query_id=task_id,
            report_type="composite_analysis",
            news_content=report,
            context_snapshot={
                "task_type": "composite_analysis",
                "stock_codes": list(snapshot.stock_codes),
                "failed_stocks": list(failures),
                "market_review_status": market_status,
                "notification_requested": snapshot.notify,
                "report_path": report_path,
            },
        )
        if history_id <= 0:
            raise RuntimeError("综合报告历史记录保存失败")

        notification_status = "disabled"
        if snapshot.notify:
            progress_callback(
                phase="notification",
                progress=94,
                patch={
                    "report": {"status": "completed", "history_id": history_id},
                    "notification": {"requested": True, "status": "processing"},
                },
                message="正在发送综合报告通知",
            )
            try:
                notification_status = (
                    "completed"
                    if pipeline.notifier.send(report, email_send_to_all=True, route_type="report")
                    else "failed"
                )
            except Exception as exc:
                logger.warning("组合报告通知发送失败: %s", exc)
                notification_status = "failed"

        partial = bool(failures) or market_status == "failed" or notification_status == "failed"
        progress_callback(
            phase="completed",
            progress=99,
            patch={
                "report": {"status": "completed", "history_id": history_id},
                "notification": {"requested": snapshot.notify, "status": notification_status},
            },
            message="综合分析已部分完成" if partial else "综合分析已完成",
        )
        return CompositeRunResult(
            status="partial" if partial else "completed",
            history_id=history_id,
            report_path=report_path,
            stock_completed=len(results),
            stock_failed=len(failures),
            market_review_status=market_status,
            notification_status=notification_status,
        ).to_dict()

    @staticmethod
    def _safe_error(error: Any) -> str:
        text = str(error or "未知原因").replace("\n", " ").strip()
        sanitized = sanitize_diagnostic_text(text) or "未知原因"
        sanitized = re.sub(
            r"(?i)\b(api[ _-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+",
            r"\1=<redacted>",
            sanitized,
        )
        return sanitized[:160]

    @staticmethod
    def _average_score(results: Sequence[AnalysisResult]) -> int:
        if not results:
            return 0
        return round(sum(int(item.sentiment_score or 0) for item in results) / len(results))

    @staticmethod
    def _compose_report(
        snapshot: CompositeAnalysisRequestSnapshot,
        stock_report: str,
        market_report: str,
        failures: Dict[str, str],
    ) -> str:
        failure_lines = (
            "\n".join(f"- `{code}`：{reason}" for code, reason in failures.items())
            if failures
            else "- 无"
        )
        return (
            "# 今日综合分析\n\n"
            f"> 执行摘要：计划 {len(snapshot.stock_codes)} 支，成功 "
            f"{len(snapshot.stock_codes) - len(failures)} 支，失败 {len(failures)} 支。\n\n"
            "## 大盘复盘\n\n"
            f"{market_report}\n\n"
            "## 个股决策仪表盘\n\n"
            f"{stock_report}\n\n"
            "## 未完成项目\n\n"
            f"{failure_lines}\n\n"
            f"> 生成时间：{datetime.now():%Y-%m-%d %H:%M:%S}。内容仅供参考，不构成投资建议。\n"
        )
