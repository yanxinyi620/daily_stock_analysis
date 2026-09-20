"""GitHub Actions entry point for the single owner's daily cloud report."""
from __future__ import annotations

from datetime import date, datetime
import logging
from uuid import NAMESPACE_URL, uuid5
from pathlib import Path

from src.services.cloud_runner import (
    CloudRunner, RunnerError, RunnerPublisher, RunnerSettings, RunnerTransport,
    execute_composite,
)

logger = logging.getLogger(__name__)
DAILY_RUNNER_ID = 'github-actions-daily'
REGIONS = {'cn', 'hk', 'us', 'jp', 'kr'}


def _trading_day(region: str, today: date) -> bool:
    """Fail closed when the calendar dependency cannot answer."""
    from src.core.trading_calendar import MARKET_EXCHANGE, _XCALS_AVAILABLE
    if not _XCALS_AVAILABLE or region not in MARKET_EXCHANGE:
        raise RunnerError('TRADING_CALENDAR_UNAVAILABLE')
    try:
        import exchange_calendars as xcals
        return bool(xcals.get_calendar(MARKET_EXCHANGE[region]).is_session(today))
    except Exception as exc:
        logger.error('Daily trading calendar failed: %s', type(exc).__name__)
        raise RunnerError('TRADING_CALENDAR_UNAVAILABLE') from exc


def run_cloud_daily(config, *, force_run: bool = False, now: datetime | None = None) -> int:
    """Submit and execute one deterministic daily composite task.

    The submission RPC registers the dedicated Actions identity atomically. A
    terminal retry returns before heartbeat or model initialization, while a
    fresh pending task attaches only to this process's registered session.
    """
    region = str(getattr(config, 'market_review_region', 'cn'))
    if region not in REGIONS:
        raise RunnerError('INVALID_INPUT')
    from src.core.trading_calendar import get_market_now
    run_date = get_market_now(region, now).date()
    if not force_run and not _trading_day(region, run_date):
        logger.info('Daily cloud analysis skipped: non-trading day')
        return 0

    # The daily RPC registers a fixed 60s lease and 30s claim window. Local
    # runner overrides must not make this worker heartbeat after its lease.
    settings = RunnerSettings(DAILY_RUNNER_ID, 15, 60, 30, 3,
                              Path(config.log_dir) / 'cloud-daily-packages')
    transport = RunnerTransport(config)
    runner = CloudRunner(settings, transport, RunnerPublisher(config),
                         lambda task, progress: execute_composite(config, task, progress,
                                                                 cancel_requested=runner.stopped.is_set,
                                                                 trigger_source='github_actions'))
    request_id = str(uuid5(NAMESPACE_URL, f'dsa-daily:{transport.user_id}:{run_date.isoformat()}:{region}'))
    task = transport.rpc('cloud_submit_daily_execution', p_runner_id=settings.runner_id,
                         p_request_id=request_id, p_session_id=runner.session_id, p_region=region)
    if not isinstance(task, dict) or task.get('user_id') != transport.user_id:
        raise RunnerError('INVALID_TASK')
    status = task.get('status')
    if status in ('succeeded', 'failed'):
        return 0 if status == 'succeeded' else 1
    task_session = task.get('session_id')
    if status != 'pending' or task_session != runner.session_id:
        # A pending/running retry belongs to another process. Never steal its
        # lease or stop it during cleanup.
        return 1
    if not isinstance(task_session, str):
        raise RunnerError('INVALID_TASK')
    runner.start_existing()
    try:
        from src.services.cloud_engine_storage import initialize_cloud_engine
        initialize_cloud_engine(config.cloud_runner_database_url)
        claimed = runner._rpc('cloud_claim_execution')
        if not claimed or claimed.get('id') != task.get('id'):
            return 1
        return 0 if runner.execute_task(claimed) else 1
    finally:
        runner.close()
