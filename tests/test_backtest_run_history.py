import os
import tempfile
from datetime import date

from src.config import Config
from src.repositories.backtest_repo import BacktestRepository
from src.storage import BacktestRun, DatabaseManager


def test_backtest_run_history_persists_lifecycle_and_lists_newest_first():
    with tempfile.TemporaryDirectory() as temp_dir:
        old_path = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = os.path.join(temp_dir, "backtest-runs.db")
        Config._instance = None
        DatabaseManager.reset_instance()
        try:
            db = DatabaseManager.get_instance()
            repo = BacktestRepository(db)
            repo.create_run(
                BacktestRun(
                    run_id="run-1",
                    task_id="task-1",
                    source="web",
                    status="pending",
                    code="600519",
                    force=True,
                    eval_window_days=1,
                    min_age_days=0,
                    analysis_date_from=date(2026, 8, 1),
                    analysis_date_to=date(2026, 8, 17),
                    result_limit=200,
                )
            )
            repo.mark_run_processing("run-1")
            repo.complete_run(
                "run-1",
                status="partial",
                stats={
                    "processed": 3,
                    "saved": 2,
                    "completed": 2,
                    "insufficient": 0,
                    "errors": 1,
                    "message": "1 条失败",
                    "diagnostics": {"empty_reason": None},
                },
            )

            items, total = repo.list_runs(offset=0, limit=20)

            assert total == 1
            assert items[0].run_id == "run-1"
            assert items[0].status == "partial"
            assert items[0].completed_count == 2
            assert items[0].errors_count == 1
            assert items[0].completed_at is not None
        finally:
            DatabaseManager.reset_instance()
            Config._instance = None
            if old_path is None:
                os.environ.pop("DATABASE_PATH", None)
            else:
                os.environ["DATABASE_PATH"] = old_path
