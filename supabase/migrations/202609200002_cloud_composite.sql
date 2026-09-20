-- Composite analysis snapshots the member's saved watchlist in the same
-- transaction that creates its runner task. Existing migrations are immutable.
begin;

alter table public.execution_tasks
    add column result_summary jsonb;
alter table public.execution_tasks
    add constraint execution_tasks_result_summary_check
        check (result_summary is null or jsonb_typeof(result_summary) = 'object');
alter table public.execution_tasks
    drop constraint execution_tasks_task_type_check;
alter table public.execution_tasks
    add constraint execution_tasks_task_type_check
        check (task_type in ('stock_analysis', 'market_review', 'composite_analysis'));

-- The engine records composite reports using this value; preserve all old data.
alter table dsa_engine.analysis_history
    alter column report_type type varchar(32);

create or replace function public.cloud_submit_execution(p_user_id uuid, p_runner_id text, p_request_id uuid,
    p_task_type text, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    r public.runner_status;
    t public.execution_tasks;
    v_snapshot jsonb;
    v_codes jsonb;
    v_input jsonb;
begin
    if p_request_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    if p_task_type is null or p_input is null or jsonb_typeof(p_input) <> 'object'
       or octet_length(p_input::text) > 65536
       or (p_task_type = 'stock_analysis' and (
           (select count(*) from jsonb_object_keys(p_input)) <> 1
           or not (p_input ? 'stock_code') or jsonb_typeof(p_input->'stock_code') <> 'string'
           or (p_input->>'stock_code') !~ '^(?:[0-9]{6}|hk[0-9]{5}|[A-Z][A-Z0-9.^-]{0,19})$'
       ))
       or (p_task_type in ('market_review', 'composite_analysis') and (
           (select count(*) from jsonb_object_keys(p_input)) <> 1
           or not (p_input ? 'region') or jsonb_typeof(p_input->'region') <> 'string'
           or (p_input->>'region') not in ('cn', 'hk', 'us', 'jp', 'kr')
       ))
       or p_task_type not in ('stock_analysis', 'market_review', 'composite_analysis') then
        raise exception 'INVALID_INPUT';
    end if;

    select * into r from public.runner_status
      where user_id = p_user_id and runner_id = p_runner_id for update;
    if not found then raise exception 'RUNNER_OFFLINE'; end if;
    perform public.cloud_runner_reconcile_locked(p_user_id, p_runner_id);
    if r.online_until <= now() then raise exception 'RUNNER_OFFLINE'; end if;

    select * into t from public.execution_tasks
      where user_id = p_user_id and runner_id = p_runner_id and request_id = p_request_id for update;
    if found then
        if t.task_type <> p_task_type
           or (p_task_type = 'composite_analysis' and t.input_json->>'region' <> p_input->>'region')
           or (p_task_type <> 'composite_analysis' and t.input_json <> p_input) then
            raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
        end if;
        return to_jsonb(t);
    end if;
    if exists (select 1 from public.execution_tasks
        where user_id = p_user_id and runner_id = p_runner_id and status in ('pending', 'running')) then
        raise exception 'RUNNER_BUSY';
    end if;

    if p_task_type = 'composite_analysis' then
        select coalesce(jsonb_agg(jsonb_build_object(
                'market', w.market, 'code', w.code, 'name', w.name, 'position', w.position)
                order by w.position, w.id), '[]'::jsonb),
               coalesce(jsonb_agg(to_jsonb(w.code) order by w.position, w.id), '[]'::jsonb)
          into v_snapshot, v_codes
          from public.watchlists w where w.user_id = p_user_id;
        if jsonb_array_length(v_snapshot) = 0 then raise exception 'EMPTY_WATCHLIST'; end if;
        v_input := jsonb_build_object('region', p_input->>'region', 'stock_codes', v_codes,
            'watchlist_snapshot', v_snapshot);
        if octet_length(v_input::text) > 65536 then raise exception 'SNAPSHOT_TOO_LARGE'; end if;
    else
        v_input := p_input;
    end if;

    insert into public.execution_tasks(user_id, runner_id, request_id, task_type, input_json, session_id, claim_deadline)
      values (p_user_id, p_runner_id, p_request_id, p_task_type, v_input, r.session_id,
        least(r.online_until, now() + make_interval(secs => r.claim_seconds))) returning * into t;
    return to_jsonb(t);
end;
$$;

create or replace function public.cloud_finish_execution(p_user_id uuid, p_runner_id text, p_session_id uuid,
    p_task_id uuid, p_report_id uuid default null, p_error_code text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status; t public.execution_tasks;
begin
    if p_session_id is null or p_task_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    if (p_report_id is null and p_error_code is null) or (p_report_id is not null and p_error_code is not null)
       or (p_error_code is not null and length(p_error_code) not between 1 and 100) then raise exception 'INVALID_INPUT'; end if;
    select * into strict r from public.runner_status where user_id=p_user_id and runner_id=p_runner_id for update;
    perform public.cloud_runner_reconcile_locked(p_user_id,p_runner_id);
    select * into strict t from public.execution_tasks where id=p_task_id for update;
    if t.user_id <> p_user_id or t.runner_id <> p_runner_id or t.session_id <> p_session_id then raise exception 'TASK_NOT_OWNED'; end if;
    if (t.status = 'succeeded' and t.report_id = p_report_id and p_error_code is null)
       or (t.status = 'failed' and t.report_id is null and t.error_code = p_error_code and p_report_id is null) then return to_jsonb(t); end if;
    if t.task_type = 'composite_analysis' and p_report_id is not null then raise exception 'COMPOSITE_SUMMARY_REQUIRED'; end if;
    if r.session_id <> p_session_id or r.online_until <= now() or r.current_task_id <> p_task_id or t.status <> 'running' then raise exception 'TASK_NOT_OWNED'; end if;
    if p_report_id is not null and not exists (select 1 from public.analysis_reports where task_id=p_report_id and user_id=p_user_id) then raise exception 'REPORT_NOT_OWNED'; end if;
    update public.execution_tasks set status=case when p_report_id is null then 'failed' else 'succeeded' end,
        report_id=p_report_id,error_code=p_error_code,progress=case when p_report_id is null then progress else 100 end,
        completed_at=now(),updated_at=now() where id=p_task_id returning * into t;
    update public.runner_status set current_task_id=null where user_id=p_user_id and runner_id=p_runner_id;
    return to_jsonb(t);
end;
$$;

create or replace function public.cloud_complete_runner_publish(p_user_id uuid, p_runner_id text, p_session_id uuid,
    p_task_id uuid, p_report_id uuid, p_hash text, p_payload jsonb, p_path text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
    r public.runner_status;
    t public.execution_tasks;
    publish_status text;
    v_summary jsonb;
    v_completed integer;
    v_failed integer;
    v_total integer;
    v_failed_length integer;
begin
    if p_session_id is null or p_task_id is null or p_report_id is null or p_hash is null or p_payload is null or p_path is null then
        raise exception 'INVALID_INPUT';
    end if;
    perform public.cloud_runner_require_member(p_user_id);
    select * into strict r from public.runner_status where user_id=p_user_id and runner_id=p_runner_id for update;
    perform public.cloud_runner_reconcile_locked(p_user_id,p_runner_id);
    select * into strict t from public.execution_tasks where id=p_task_id for update;
    if t.user_id <> p_user_id or t.runner_id <> p_runner_id or t.session_id <> p_session_id then raise exception 'TASK_NOT_OWNED'; end if;
    if t.status = 'succeeded' and t.report_id = p_report_id then return 'succeeded'; end if;
    if r.session_id <> p_session_id or r.online_until <= now() or r.current_task_id <> p_task_id or t.status <> 'running' then raise exception 'TASK_NOT_OWNED'; end if;

    if t.task_type = 'composite_analysis' then
        v_summary := p_payload->'execution_summary';
        if v_summary is null or jsonb_typeof(v_summary) <> 'object'
           or (select count(*) from jsonb_object_keys(v_summary)) <> 5
           or not (v_summary ?& array['outcome','stock_completed','stock_failed','market_review_status','failed_stocks'])
           or jsonb_typeof(v_summary->'outcome') <> 'string' or v_summary->>'outcome' not in ('completed', 'partial')
           or jsonb_typeof(v_summary->'stock_completed') <> 'number' or (v_summary->>'stock_completed') !~ '^[0-9]{1,5}$'
           or jsonb_typeof(v_summary->'stock_failed') <> 'number' or (v_summary->>'stock_failed') !~ '^[0-9]{1,5}$'
           or jsonb_typeof(v_summary->'market_review_status') <> 'string' or v_summary->>'market_review_status' not in ('completed', 'failed')
           or jsonb_typeof(v_summary->'failed_stocks') <> 'array'
           or exists (select 1 from jsonb_array_elements(v_summary->'failed_stocks') s where jsonb_typeof(s) <> 'string') then
            raise exception 'INVALID_INPUT';
        end if;
        v_completed := (v_summary->>'stock_completed')::integer;
        v_failed := (v_summary->>'stock_failed')::integer;
        v_total := jsonb_array_length(t.input_json->'stock_codes');
        v_failed_length := jsonb_array_length(v_summary->'failed_stocks');
        if v_completed + v_failed <> v_total or v_failed_length <> v_failed
           or (select count(*) from (select value from jsonb_array_elements_text(v_summary->'failed_stocks')) s) <>
              (select count(distinct value) from jsonb_array_elements_text(v_summary->'failed_stocks') s)
           or exists (select 1 from jsonb_array_elements_text(v_summary->'failed_stocks') s(value)
               where not exists (select 1 from jsonb_array_elements_text(t.input_json->'stock_codes') c(value) where c.value = s.value))
           or (v_summary->>'outcome' = 'partial') <> (v_failed > 0 or v_summary->>'market_review_status' = 'failed')
           or (v_completed = 0 and v_summary->>'market_review_status' = 'failed') then
            raise exception 'INVALID_INPUT';
        end if;
    elsif p_payload ? 'execution_summary' then
        raise exception 'INVALID_INPUT';
    end if;

    publish_status := public.cloud_complete_publish(p_report_id, p_user_id, p_hash, p_payload, p_path);
    if publish_status <> 'succeeded' then raise exception 'PUBLISH_INCOMPLETE'; end if;
    update public.execution_tasks set status='succeeded', report_id=p_report_id, error_code=null, progress=100,
        result_summary=v_summary, completed_at=now(), updated_at=now() where id=p_task_id;
    update public.runner_status set current_task_id=null where user_id=p_user_id and runner_id=p_runner_id;
    return 'succeeded';
end;
$$;

revoke all on function public.cloud_submit_execution(uuid,text,uuid,text,jsonb),
 public.cloud_finish_execution(uuid,text,uuid,uuid,uuid,text),
 public.cloud_complete_runner_publish(uuid,text,uuid,uuid,uuid,text,jsonb,text)
 from public, anon, authenticated;
grant execute on function public.cloud_submit_execution(uuid,text,uuid,text,jsonb),
 public.cloud_finish_execution(uuid,text,uuid,uuid,uuid,text),
 public.cloud_complete_runner_publish(uuid,text,uuid,uuid,uuid,text,jsonb,text)
 to service_role;

commit;
