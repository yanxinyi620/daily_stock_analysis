"""Automatic name enrichment without model calls or private credentials."""
from types import SimpleNamespace
from unittest.mock import Mock
import threading

import pytest

USER = '11111111-1111-4111-8111-111111111111'


def service(rows, lookup=None):
    from src.services.cloud_watchlist_names import CloudWatchlistNames
    config = SimpleNamespace(supabase_url='https://example.supabase.co', supabase_secret_key='test',
                             supabase_publish_user_id=USER, supabase_publish_timeout=2,
                             enable_actions_dispatch=False)
    session = Mock()
    responses = [Mock(status_code=200, json=lambda: rows)]
    responses += [Mock(status_code=200, json=lambda: True) for _ in rows]
    session.request.side_effect = responses
    resolver = lookup or Mock(return_value='平安银行')
    return CloudWatchlistNames(config, session=session, lookup=resolver), session, resolver


def row(code='000001', name=''):
    return {'id': '22222222-2222-4222-8222-222222222222', 'market': 'CN', 'code': code, 'name': name}


def test_fills_only_missing_names_with_owner_and_compare_values():
    item = row()
    worker, session, lookup = service([item, row('000002', '我的名称')])
    worker.refresh(threading.Event())
    lookup.assert_called_once_with('000001')
    payload = session.request.call_args.kwargs['json']
    assert payload == dict(p_user_id=USER, p_id=item['id'], p_market='CN', p_code='000001',
                           p_old_name='', p_name='平安银行')
    assert item['name'] == ''  # Do not rewrite submitted snapshots or input rows.
    assert session.request.call_args.kwargs['allow_redirects'] is False


@pytest.mark.parametrize('name', ['', '000001', 'UNKNOWN', '股票000001', 'x' * 101, None])
def test_does_not_write_failed_or_placeholder_lookup(name):
    worker, session, _ = service([row()], Mock(return_value=name))
    worker.refresh(threading.Event())
    assert session.request.call_count == 1


def test_lookup_failure_is_redacted_and_next_stock_continues(caplog):
    worker, session, _ = service([row(), row('000002')], Mock(side_effect=[RuntimeError('secret'), '万科A']))
    worker.refresh(threading.Event())
    assert session.request.call_count == 2
    assert session.request.call_args.kwargs['json']['p_code'] == '000002'
    assert 'secret' not in caplog.text
    assert 'name' in caplog.text.lower()


def test_stop_during_lookup_prevents_write():
    stop = threading.Event()
    def lookup(_code):
        stop.set()
        return '平安银行'
    worker, session, _ = service([row()], lookup)
    worker.refresh(stop)
    assert session.request.call_count == 1


def test_background_stops_without_query_when_already_stopped():
    stop = threading.Event(); stop.set()
    worker, session, _ = service([row()])
    thread = worker.start_background(stop)
    thread.join(1)
    assert not thread.is_alive()
    session.request.assert_not_called()


def test_overlapping_refresh_does_not_duplicate_queries():
    worker, session, _ = service([row()])
    worker._lock.acquire()
    try:
        worker.refresh(threading.Event())
        session.request.assert_not_called()
    finally:
        worker._lock.release()


def test_background_refresh_is_immediate_then_waits_five_minutes():
    worker, _, _ = service([])
    stopped = Mock()
    stopped.is_set.return_value = False
    stopped.wait.return_value = True
    worker.refresh = Mock()
    thread = worker.start_background(stopped)
    thread.join(1)
    worker.refresh.assert_called_once_with(stopped)
    stopped.wait.assert_called_once_with(300)


def test_http_failure_is_nonfatal_and_redacted(caplog):
    worker, session, _ = service([])
    session.request.side_effect = None
    session.request.return_value = Mock(status_code=500, json=lambda: {'message': 'private secret'})
    worker.refresh(threading.Event())
    assert 'private secret' not in caplog.text
    assert 'unavailable' in caplog.text


def test_code_placeholder_is_eligible_and_cas_race_is_normal(caplog):
    worker, session, lookup = service([row(name='000001')])
    session.request.side_effect = [Mock(status_code=200, json=lambda: [row(name='000001')]),
                                   Mock(status_code=200, json=lambda: False)]
    worker.refresh(threading.Event())
    lookup.assert_called_once_with('000001')
    assert session.request.call_args.kwargs['json']['p_old_name'] == '000001'
    assert not caplog.text
