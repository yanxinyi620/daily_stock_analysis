"""Best-effort code-to-name completion for the configured cloud owner's watchlist."""
from __future__ import annotations

import logging
import threading

from src.data.stock_mapping import is_meaningful_stock_name
from src.services.cloud_publisher import CloudPublisher, PublishError

logger = logging.getLogger(__name__)
_REFRESH_SECONDS = 300


class CloudWatchlistNames(CloudPublisher):
    """Use a dedicated HTTP session; SQL compare-and-set preserves concurrent edits."""

    def __init__(self, config, *, session=None, lookup=None):
        super().__init__(config, session=session)
        self._lookup = lookup
        self._fetcher = None
        self._lock = threading.Lock()

    def _resolve(self, code):
        if self._lookup is not None:
            return self._lookup(code)
        if self._fetcher is None:
            from data_provider import DataFetcherManager
            self._fetcher = DataFetcherManager()
        return self._fetcher.get_stock_name(code, allow_realtime=False)

    def refresh(self, stopped: threading.Event):
        """Never delay heartbeats or overwrite edits made while a lookup was running."""
        if stopped.is_set() or not self._lock.acquire(blocking=False):
            return
        try:
            rows = self._request('POST', '/rest/v1/rpc/cloud_watchlist_name_candidates',
                                 json_body={'p_user_id': self.user_id})
            if not isinstance(rows, list):
                raise PublishError('Invalid watchlist name candidates')
            for row in rows:
                if stopped.is_set():
                    break
                try:
                    code, old_name = row['code'], row['name']
                    if old_name.strip() and old_name.strip().upper() != code.upper():
                        continue
                    name = self._resolve(code)
                    if stopped.is_set():
                        break
                    if not isinstance(name, str) or not is_meaningful_stock_name(name, code):
                        continue
                    name = name.strip()
                    if len(name) > 100:
                        continue
                    updated = self._request('POST', '/rest/v1/rpc/cloud_fill_watchlist_name', json_body={
                        'p_user_id': self.user_id, 'p_id': row['id'], 'p_market': row['market'],
                        'p_code': code, 'p_old_name': old_name, 'p_name': name,
                    })
                    if updated is not True and updated is not False:
                        raise PublishError('Invalid watchlist name update result')
                except Exception:
                    # Provider exceptions and HTTP bodies may contain private details.
                    logger.warning('Cloud watchlist name lookup/update failed; will retry on next refresh')
        except Exception:
            logger.warning('Cloud watchlist name refresh unavailable; check migration and connectivity')
        finally:
            self._lock.release()

    def start_background(self, stopped: threading.Event) -> threading.Thread:
        """One immediate pass, then every five minutes until the Runner stops."""
        def run():
            while not stopped.is_set():
                self.refresh(stopped)
                if stopped.wait(_REFRESH_SECONDS):
                    break
        thread = threading.Thread(target=run, name='cloud-watchlist-names', daemon=True)
        thread.start()
        return thread
