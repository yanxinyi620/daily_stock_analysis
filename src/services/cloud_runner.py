"""Single outbound-only cloud worker. No API server, scheduler or in-memory queue."""
from __future__ import annotations

import copy
from dataclasses import dataclass
import json
import logging
from pathlib import Path
import re
import threading
from typing import Callable
from uuid import NAMESPACE_URL, uuid4, uuid5

from src.services.cloud_publisher import CloudPublisher, PublishError, build_envelope, save_package

logger = logging.getLogger(__name__)


class RunnerError(RuntimeError):
    """Sanitized runner failure; secrets and backend bodies never form its message."""


@dataclass(frozen=True)
class RunnerSettings:
    runner_id: str
    heartbeat_seconds: float
    online_seconds: int
    claim_seconds: int
    poll_seconds: float
    package_dir: Path

    @classmethod
    def from_config(cls, config):
        result = cls(config.cloud_runner_id, config.cloud_runner_heartbeat_seconds,
                     config.cloud_runner_online_seconds, config.cloud_runner_claim_seconds,
                     config.cloud_runner_poll_seconds, Path(config.log_dir) / 'cloud-runner-packages')
        if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', result.runner_id) or
                not 1 <= result.heartbeat_seconds < result.online_seconds / 2 or
                not 15 <= result.online_seconds <= 300 or
                not 5 <= result.claim_seconds <= min(120, result.online_seconds) or
                not 1 <= result.poll_seconds < result.claim_seconds):
            raise RunnerError('Invalid Runner timing or identity configuration')
        return result


class RunnerTransport(CloudPublisher):
    """Reuse the existing bounded, redacted Supabase HTTP adapter."""

    def rpc(self, name: str, **params):
        try:
            return self._request('POST', f'/rest/v1/rpc/{name}', json_body={
                'p_user_id': self.user_id, **params,
            })
        except PublishError:
            raise RunnerError('RUNNER_TRANSPORT') from None


class RunnerPublisher(CloudPublisher):
    """Fence the visible report and task completion in the same DB transaction."""

    def publish_for_task(self, envelope, *, runner_id, session_id, execution_id):
        self._execution = (runner_id, session_id, execution_id)
        try:
            return self.publish(envelope)
        finally:
            self._execution = None

    def _request(self, method, path, *, json_body=None, data=None, upload=False):
        if path == '/rest/v1/rpc/cloud_complete_publish':
            if not getattr(self, '_execution', None):
                raise PublishError('runner publication requires an execution context')
            runner_id, session_id, execution_id = self._execution
            json_body = {**json_body, 'p_report_id': json_body['p_task_id'],
                         'p_task_id': execution_id, 'p_runner_id': runner_id,
                         'p_session_id': session_id}
            path = '/rest/v1/rpc/cloud_complete_runner_publish'
        return super()._request(method, path, json_body=json_body, data=data, upload=upload)


class CloudRunner:
    def __init__(self, settings: RunnerSettings, transport: RunnerTransport,
                 publisher: CloudPublisher, execute: Callable):
        self.settings = settings
        self.transport = transport
        self.publisher = publisher
        self.execute = execute
        self.session_id = str(uuid4())
        self.stopped = threading.Event()
        self.heartbeat_thread = None

    def _rpc(self, name: str, **params):
        return self.transport.rpc(name, p_runner_id=self.settings.runner_id,
                                  p_session_id=self.session_id, **params)

    def start(self):
        self._rpc('cloud_runner_register', p_online_seconds=self.settings.online_seconds,
                  p_claim_seconds=self.settings.claim_seconds)
        self.start_existing()

    def start_existing(self):
        """Attach heartbeats to a session registered by an atomic submit RPC."""
        self.heartbeat_thread = threading.Thread(target=self._heartbeat, name='cloud-runner-heartbeat', daemon=True)
        self.heartbeat_thread.start()

    def _heartbeat(self):
        while not self.stopped.wait(self.settings.heartbeat_seconds):
            try:
                self._rpc('cloud_runner_heartbeat')
            except RunnerError:
                # Fail closed. A partition must not let this process claim another task.
                logger.error('Runner heartbeat unavailable; stopping new work')
                self.stopped.set()

    def close(self):
        self.stopped.set()
        if self.heartbeat_thread:
            self.heartbeat_thread.join(timeout=self.transport.timeout if isinstance(self.transport.timeout, (int, float)) else 5)
        try:
            self._rpc('cloud_runner_stop')
        except RunnerError:
            logger.warning('Runner stop could not be confirmed; heartbeat lease will expire')

    def execute_task(self, task: dict):
        if task.get('user_id') != self.transport.user_id:
            raise RunnerError('INVALID_TASK')
        validate_task_input(task)
        task_id = task['id']
        report_id = str(uuid5(NAMESPACE_URL, f'dsa-report:{self.transport.user_id}:{task_id}'))
        package = self.settings.package_dir / f'{report_id}.json'
        error = 'ANALYSIS_FAILED'
        try:
            if package.exists():
                error = 'PUBLISH_FAILED'
                envelope = json.loads(package.read_text(encoding='utf-8'))
                self.publisher._validate_envelope(envelope)
                if envelope['task_id'] != report_id:
                    raise PublishError('saved package does not belong to the claimed execution')
            else:
                def progress(value, _message):
                    if self.stopped.is_set():
                        raise RunnerError('RUNNER_STOPPED')
                    # Provider diagnostics may contain private request details; expose only a stage.
                    try:
                        self._rpc('cloud_progress_execution', p_task_id=task_id,
                                  p_progress=max(0, min(99, int(value))), p_message='正在分析')
                    except RunnerError:
                        self.stopped.set()
                        raise
                if task['task_type'] == 'composite_analysis':
                    markdown, results, execution_summary = self.execute(task, progress)
                else:
                    markdown, results = self.execute(task, progress)
                    execution_summary = None
                if not markdown:
                    raise RunnerError('EMPTY_RESULT')
                envelope = build_envelope(self.transport.user_id, task_id, markdown, results,
                                          execution_summary=execution_summary)
                save_package(envelope, self.settings.package_dir)
            if self.stopped.is_set():
                raise RunnerError('RUNNER_STOPPED')
            error = 'PUBLISH_FAILED'
            # Repeat only the saved content, never analysis. At most two HTTP publication attempts.
            for attempt in range(2):
                try:
                    self.publisher.publish_for_task(envelope, runner_id=self.settings.runner_id,
                                                    session_id=self.session_id, execution_id=task_id)
                    break
                except PublishError:
                    if attempt == 1:
                        raise
            error = 'COMPLETION_UNCONFIRMED'
            self._rpc('cloud_finish_execution', p_task_id=task_id, p_report_id=report_id,
                      p_error_code=None)
            return True
        except Exception:
            logger.error('Cloud task did not complete: %s', error)
            try:
                self._rpc('cloud_finish_execution', p_task_id=task_id, p_report_id=None,
                          p_error_code=error)
            except RunnerError:
                # Preserve package, leave the authoritative lease to reconcile the task.
                logger.error('Cloud task failure could not be confirmed; no automatic analysis retry')
            return False

    def run(self):
        self.start()
        try:
            while not self.stopped.is_set():
                task = self._rpc('cloud_claim_execution')
                if task:
                    self.execute_task(task)
                self.stopped.wait(self.settings.poll_seconds)
        finally:
            self.close()


def validate_task_input(task):
    """Keep the worker boundary as strict as the task API and database RPC."""
    payload = task.get('input_json')
    if not isinstance(payload, dict):
        raise RunnerError('INVALID_TASK')
    if task.get('task_type') == 'stock_analysis':
        code = payload.get('stock_code')
        valid = (set(payload) == {'stock_code'} and isinstance(code, str) and
                 re.fullmatch(r'(?:\d{6}|hk\d{5}|[A-Z][A-Z0-9.^-]{0,19})', code))
    elif task.get('task_type') == 'composite_analysis':
        from src.utils.market_review_region import MARKET_REVIEW_REGION_ORDER
        codes = payload.get('stock_codes')
        snapshot = payload.get('watchlist_snapshot')
        valid = (set(payload) == {'region', 'stock_codes', 'watchlist_snapshot'} and
                 payload.get('region') in MARKET_REVIEW_REGION_ORDER and isinstance(codes, list) and
                 bool(codes) and all(isinstance(code, str) and re.fullmatch(r'(?:\d{6}|hk\d{5}|[A-Z][A-Z0-9.^-]{0,19})', code) for code in codes) and
                 len(set(codes)) == len(codes) and isinstance(snapshot, list) and len(snapshot) == len(codes) and
                 all(isinstance(row, dict) and set(row) == {'market', 'code', 'name', 'position'} and
                     row['code'] == code and row['market'] in ('CN', 'HK', 'US') and
                     isinstance(row['name'], str) and isinstance(row['position'], int) and not isinstance(row['position'], bool)
                     for row, code in zip(snapshot, codes)))
    elif task.get('task_type') == 'market_review':
        from src.utils.market_review_region import MARKET_REVIEW_REGION_ORDER
        valid = set(payload) == {'region'} and payload.get('region') in MARKET_REVIEW_REGION_ORDER
    else:
        valid = False
    if not valid:
        raise RunnerError('INVALID_TASK')


def execute_analysis(config, task, progress, *, cancel_requested=lambda: False):
    validate_task_input(task)
    if task['task_type'] == 'composite_analysis':
        return execute_composite(config, task, progress, cancel_requested=cancel_requested)
    if task['task_type'] == 'market_review':
        return execute_market_review(config, task, progress)
    return execute_stock(config, task, progress)


def execute_composite(config, task, progress, *, cancel_requested=lambda: False, trigger_source='local_runner'):
    """Run the existing composite service against the immutable cloud watchlist."""
    from src.services.composite_analysis_service import CompositeAnalysisService, CompositeAnalysisRequestSnapshot
    from src.services.run_diagnostics import activate_run_diagnostic_context, reset_run_diagnostic_context
    from src.storage import DatabaseManager

    scoped = copy.copy(config)
    scoped.supabase_publish_enabled = False
    scoped.max_workers = 1
    scoped.single_stock_notify = False
    snapshot = CompositeAnalysisRequestSnapshot(tuple(task['input_json']['stock_codes']), notify=False,
                                                report_language=config.report_language,
                                                region=task['input_json']['region'])
    db = DatabaseManager.get_instance()
    token = activate_run_diagnostic_context(trace_id=task['id'], task_id=task['id'], query_id=task['id'],
                                           stock_code='COMPOSITE', trigger_source=trigger_source, scope='composite_analysis')
    try:
        result = CompositeAnalysisService(scoped, database=db).run(
            snapshot, task_id=task['id'], progress_callback=lambda **event: progress(event['progress'], event.get('message', '')),
            cancel_requested=cancel_requested, save_report_file=False, require_persisted_components=True)
        if result['status'] not in ('completed', 'partial'):
            raise RunnerError('ANALYSIS_FAILED')
        saved = db.get_analysis_history_by_id(result['history_id'])
        if (saved is None or saved.query_id != task['id'] or saved.code != 'COMPOSITE' or
                saved.report_type != 'composite_analysis' or not saved.news_content):
            raise RunnerError('HISTORY_NOT_SAVED')
        context = json.loads(saved.context_snapshot)
        summary = {'outcome': result['status'], 'stock_completed': result['stock_completed'],
                   'stock_failed': result['stock_failed'], 'market_review_status': result['market_review_status'],
                   'failed_stocks': context['failed_stocks']}
        return saved.news_content, [{'code': 'COMPOSITE', 'name': '综合分析',
                                     'analysis_summary': saved.analysis_summary}], summary
    finally:
        reset_run_diagnostic_context(token)


def execute_market_review(config, task, progress):
    """Use the shared market engine, without local report files or notifications."""
    from src.core.market_review import run_market_review, _render_market_review_payload_markdown
    from src.core.market_review_runtime import build_market_review_runtime
    from src.services.run_diagnostics import (
        activate_run_diagnostic_context, get_current_diagnostic_context, reset_run_diagnostic_context,
    )
    from src.storage import DatabaseManager

    scoped = copy.copy(config)
    scoped.supabase_publish_enabled = False
    token = activate_run_diagnostic_context(trace_id=task['id'], task_id=task['id'],
                                           query_id=task['id'], stock_code='MARKET',
                                           trigger_source='local_runner', scope='market_review')
    try:
        progress(5, '正在初始化大盘复盘')
        notifier, analyzer, search_service = build_market_review_runtime(scoped)
        progress(15, '正在生成大盘复盘')
        result = run_market_review(notifier=notifier, analyzer=analyzer, search_service=search_service,
                                   config=scoped, override_region=task['input_json']['region'],
                                   query_id=task['id'], return_structured=True, send_notification=False,
                                   save_report_file=False, persist_history=True, trigger_source='local_runner')
        if result is None or not result.report.strip():
            raise RunnerError('ANALYSIS_FAILED')
        records = DatabaseManager.get_instance().get_analysis_history(query_id=task['id'], code='MARKET', limit=1)
        if not records or records[0].report_type != 'market_review':
            raise RunnerError('HISTORY_NOT_SAVED')
        markdown = _render_market_review_payload_markdown(result.market_review_payload)
        if not markdown.strip():
            raise RunnerError('EMPTY_RESULT')
        summary = {'code': 'MARKET', 'name': '大盘复盘',
                   'analysis_summary': f"大盘复盘（{task['input_json']['region'].upper()}）"}
        diagnostics = get_current_diagnostic_context()
        if not any(run.success for run in diagnostics.llm_runs if run.call_type == 'market_review'):
            warning = '本次使用模板生成复盘，未获得成功的模型分析；请结合数据缺失提示阅读。'
            markdown = f'> {warning}\n\n{markdown}'
            summary['risk_warning'] = warning
        progress(95, '大盘复盘已保存')
        return markdown, [summary]
    finally:
        reset_run_diagnostic_context(token)


def execute_stock(config, task, progress):
    """Use the same synchronous entry and renderer as local CLI/API analysis."""
    from src.core.pipeline import StockAnalysisPipeline
    from src.enums import ReportType
    scoped = copy.copy(config)
    scoped.supabase_publish_enabled = False  # This runner publishes exactly once under its task identity.
    pipeline = StockAnalysisPipeline(config=scoped, max_workers=1, query_id=task['id'],
                                     trace_id=task['id'], query_source='local_runner',
                                     progress_callback=progress)
    result = pipeline.process_single_stock(code=task['input_json']['stock_code'],
                                           skip_analysis=False, single_stock_notify=False,
                                           report_type=ReportType.FULL)
    if result is None or not result.success:
        raise RunnerError('ANALYSIS_FAILED')
    # Legacy pipeline treats history failures as nonfatal; cloud execution cannot.
    if not pipeline.db.get_analysis_history(query_id=task['id'], limit=1):
        raise RunnerError('HISTORY_NOT_SAVED')
    markdown = pipeline.notifier.generate_aggregate_report([result], ReportType.FULL)
    return markdown, [result.to_dict()]


def run_cloud_runner(config) -> int:
    """Explicit CLI mode: fail before registration if cloud persistence is unavailable."""
    try:
        from src.services.cloud_engine_storage import initialize_cloud_engine
        settings = RunnerSettings.from_config(config)
        transport = RunnerTransport(config)
        initialize_cloud_engine(config.cloud_runner_database_url)
        runner = CloudRunner(settings, transport, RunnerPublisher(config),
                             lambda task, progress: execute_analysis(config, task, progress, cancel_requested=runner.stopped.is_set))
        runner.run()
        return 1 if runner.stopped.is_set() else 0
    except KeyboardInterrupt:
        return 0
    except Exception:
        logger.error('Runner could not continue; check cloud configuration, migrations and connectivity')
        return 1
