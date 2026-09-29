"""Allowlisted public run evidence; never serialize exception text or input data."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import tempfile
import threading
import time

_STAGES = {'startup', 'configuration', 'reconcile', 'calendar', 'submit', 'database',
           'claim', 'analysis', 'heartbeat', 'publish', 'complete', 'stop', 'finished'}
_OUTCOMES = {'running', 'completed', 'partial', 'skipped_non_trading', 'already_succeeded',
             'already_failed', 'busy', 'failed', 'reconciled'}
_ERRORS = {'RUNNER_TRANSPORT', 'RUNNER_STOPPED', 'ANALYSIS_FAILED', 'PUBLISH_FAILED',
           'COMPLETION_UNCONFIRMED', 'RECONCILE_FAILED', 'STOP_UNCONFIRMED',
           'ENTRYPOINT_FAILED', 'CLAIM_MISMATCH'}


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


class DailyDiagnostics:
    """Bounded, atomic evidence survives failures without exporting private logs."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._started = time.monotonic()
        self._body = {'version': 1, 'started_at': _utc_now(), 'outcome': 'running', 'events': []}
        self.record('startup')

    def record(self, stage, *, outcome=None, error_code=None, error=None, region=None):
        if stage not in _STAGES or (outcome is not None and outcome not in _OUTCOMES):
            raise ValueError('Unknown diagnostic stage or outcome')
        if error_code is not None and error_code not in _ERRORS:
            raise ValueError('Unknown diagnostic error code')
        if region is not None and region not in {'cn', 'hk', 'us', 'jp', 'kr'}:
            raise ValueError('Unknown diagnostic region')
        with self._lock:
            event = {'stage': stage, 'at': _utc_now()}
            if outcome is not None:
                self._body['outcome'] = outcome
            if region is not None:
                self._body['region'] = region
            if error_code is not None:
                event['error_code'] = error_code
            if error is not None:
                # Exception class names and messages can also contain user input.
                event['error_type'] = ('timeout' if isinstance(error, TimeoutError) else
                                       'io' if isinstance(error, OSError) else 'unexpected')
                status = getattr(error, 'http_status', None)
                if type(status) is int and 100 <= status <= 599:
                    event['http_status'] = status
            events = self._body['events']
            if not events or events[-1]['stage'] != stage or error_code is not None or error is not None:
                events.append(event)
                del events[:-100]
            self._body['updated_at'] = event['at']
            self._body['duration_seconds'] = round(time.monotonic() - self._started, 3)
            try:
                self._write()
            except OSError:
                logging.getLogger(__name__).warning('Cloud diagnostic evidence could not be saved')

    def finish(self, exit_code):
        if exit_code not in (0, 1):
            raise ValueError('Unknown diagnostic exit code')
        with self._lock:
            self._body['exit_code'] = exit_code
            outcome = self._body['outcome']
            if exit_code and outcome not in {'busy', 'already_failed'}:
                outcome = 'failed'
            if outcome == 'running':
                outcome = 'completed'
            self.record('finished', outcome=outcome)

    def snapshot(self):
        with self._lock:
            return deepcopy(self._body)

    def _write(self):
        descriptor, name = tempfile.mkstemp(prefix='.daily-diagnostic-', dir=self.path.parent)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
                json.dump(self._body, stream, ensure_ascii=True, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
