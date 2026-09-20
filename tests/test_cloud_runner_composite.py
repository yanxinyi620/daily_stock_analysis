"""Composite runner persists frozen inputs and business outcome across publication retries."""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from src.services import cloud_runner
from src.services.cloud_publisher import PublishError
from tests.test_cloud_runner import setup_runner, USER, TASK


def composite_task():
    return {'id': TASK, 'user_id': USER, 'task_type': 'composite_analysis', 'input_json': {
        'region':'cn','stock_codes':['000001'],
        'watchlist_snapshot':[{'market':'CN','code':'000001','name':'test','position':0}]}}


def outcome():
    return {'outcome':'partial','stock_completed':1,'stock_failed':0,'failed_stocks':[], 'market_review_status':'failed'}


def test_composite_publish_retry_keeps_outcome_and_does_not_repeat_engine(tmp_path):
    execute=Mock(return_value=('# partial',[{'code':'COMPOSITE'}],outcome()))
    runner,transport,publisher,_=setup_runner(tmp_path,execute)
    publisher.publish.side_effect=[PublishError('temporary'), 'succeeded']
    runner.execute_task(composite_task())
    execute.assert_called_once()
    assert publisher.publish.call_count==2
    package=json.loads(next(tmp_path.glob('*.json')).read_text())
    assert package['payload']['execution_summary']==outcome()
    assert publisher.publish.call_args_list[0]==publisher.publish.call_args_list[1]


@pytest.mark.parametrize('payload', [{'region':'cn'}, {'region':'cn','stock_codes':[],'watchlist_snapshot':[]},
    {'region':'cn','stock_codes':['000002'],'watchlist_snapshot':[{'market':'CN','code':'000001','name':'x','position':0}]}])
def test_runner_rejects_invalid_frozen_snapshot(tmp_path,payload):
    runner,_,publisher,execute=setup_runner(tmp_path)
    with pytest.raises(cloud_runner.RunnerError):runner.execute_task(dict(composite_task(),input_json=payload))
    execute.assert_not_called();publisher.publish.assert_not_called()


def test_composite_adapter_reads_durable_report_and_uses_frozen_snapshot(monkeypatch):
    from src.services.composite_analysis_service import CompositeAnalysisService
    saved=SimpleNamespace(query_id=TASK,code='COMPOSITE',report_type='composite_analysis',news_content='# Partial report',
                          context_snapshot=json.dumps({'failed_stocks':[]}),analysis_summary='summary')
    db=Mock();db.get_analysis_history_by_id.return_value=saved
    monkeypatch.setattr('src.storage.DatabaseManager.get_instance',Mock(return_value=db))
    run=Mock(return_value={'status':'partial','history_id':42,'stock_completed':1,'stock_failed':0,'market_review_status':'failed'})
    monkeypatch.setattr(CompositeAnalysisService,'run',run)
    config=SimpleNamespace(supabase_publish_enabled=True,max_workers=3,report_language='zh')
    cancelled=Mock(return_value=False)
    report,results,summary=cloud_runner.execute_composite(config,composite_task(),Mock(),cancel_requested=cancelled)
    assert report=='# Partial report' and summary==outcome() and results[0]['code']=='COMPOSITE'
    snap=run.call_args.args[0];assert snap.stock_codes==('000001',) and not snap.notify
    assert run.call_args.kwargs['save_report_file'] is False
    assert run.call_args.kwargs['require_persisted_components'] is True
    assert run.call_args.kwargs['cancel_requested'] is cancelled
    assert config.supabase_publish_enabled is True and config.max_workers==3


def test_composite_does_not_publish_when_saved_history_is_missing(monkeypatch):
    from src.services.composite_analysis_service import CompositeAnalysisService
    db=Mock();db.get_analysis_history_by_id.return_value=None
    monkeypatch.setattr('src.storage.DatabaseManager.get_instance',Mock(return_value=db))
    monkeypatch.setattr(CompositeAnalysisService,'run',Mock(return_value={'status':'completed','history_id':42}))
    with pytest.raises(cloud_runner.RunnerError,match='HISTORY_NOT_SAVED'):
        cloud_runner.execute_composite(SimpleNamespace(report_language='zh'),composite_task(),Mock())


def test_misplaced_saved_package_cannot_publish_for_another_execution(tmp_path):
    from src.services.cloud_publisher import build_envelope
    runner,transport,publisher,execute=setup_runner(tmp_path)
    expected=build_envelope(USER,TASK,'# expected',[])
    wrong=build_envelope(USER,'another-task','# other',[])
    (tmp_path / (expected['task_id']+'.json')).write_text(json.dumps(wrong))
    runner.execute_task(composite_task())
    publisher.publish_for_task.assert_not_called()
    execute.assert_not_called()
    assert transport.rpc.call_args.kwargs['p_error_code']=='PUBLISH_FAILED'
