-- Add singleton market-review submissions without changing existing runner leases.
begin;

alter table public.execution_tasks drop constraint execution_tasks_task_type_check;
alter table public.execution_tasks add constraint execution_tasks_task_type_check
    check (task_type in ('stock_analysis', 'market_review'));

create or replace function public.cloud_submit_execution(p_user_id uuid, p_runner_id text, p_request_id uuid,
    p_task_type text, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status; t public.execution_tasks;
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
       or (p_task_type = 'market_review' and (
           (select count(*) from jsonb_object_keys(p_input)) <> 1
           or not (p_input ? 'region') or jsonb_typeof(p_input->'region') <> 'string'
           or (p_input->>'region') not in ('cn', 'hk', 'us', 'jp', 'kr')
       ))
       or p_task_type not in ('stock_analysis', 'market_review') then
        raise exception 'INVALID_INPUT';
    end if;
    select * into r from public.runner_status where user_id = p_user_id and runner_id = p_runner_id for update;
    if not found then raise exception 'RUNNER_OFFLINE'; end if;
    perform public.cloud_runner_reconcile_locked(p_user_id, p_runner_id);
    if r.online_until <= now() then raise exception 'RUNNER_OFFLINE'; end if;
    select * into t from public.execution_tasks where user_id=p_user_id and runner_id=p_runner_id and request_id=p_request_id for update;
    if found then
        if t.task_type <> p_task_type or t.input_json <> p_input then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
        return to_jsonb(t);
    end if;
    if exists (select 1 from public.execution_tasks where user_id=p_user_id and runner_id=p_runner_id and status in ('pending','running')) then
        raise exception 'RUNNER_BUSY';
    end if;
    insert into public.execution_tasks(user_id,runner_id,request_id,task_type,input_json,session_id,claim_deadline)
      values (p_user_id,p_runner_id,p_request_id,p_task_type,p_input,r.session_id,
        least(r.online_until, now() + make_interval(secs => r.claim_seconds))) returning * into t;
    return to_jsonb(t);
end;
$$;

revoke all on function public.cloud_submit_execution(uuid,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.cloud_submit_execution(uuid,text,uuid,text,jsonb) to service_role;

commit;
