-- Atomic daily admission; reuse the existing snapshot and lease contracts.
begin;

create function public.cloud_submit_daily_execution(
    p_user_id uuid, p_runner_id text, p_request_id uuid,
    p_session_id uuid, p_region text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    r public.runner_status;
    t public.execution_tasks;
begin
    if p_user_id is null or p_request_id is null or p_session_id is null
       or p_runner_id is null or length(trim(p_runner_id)) not between 1 and 128
       or p_region is null or p_region not in ('cn', 'hk', 'us', 'jp', 'kr') then
        raise exception 'INVALID_INPUT';
    end if;
    perform public.cloud_runner_require_member(p_user_id);
    -- Serialize first registration too, before a runner row exists.
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_runner_id, 0));
    select * into r from public.runner_status
      where user_id = p_user_id and runner_id = p_runner_id for update;
    if found then
        -- Preserve global lock order (runner, then executions), and make an
        -- interrupted same-day retry visibly failed rather than stuck running.
        perform public.cloud_runner_reconcile_locked(p_user_id, p_runner_id);
    end if;
    select * into t from public.execution_tasks
      where user_id = p_user_id and runner_id = p_runner_id and request_id = p_request_id;
    if found then
        if t.task_type <> 'composite_analysis' or t.input_json->>'region' <> p_region then
            raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
        end if;
        -- Never adopt or replace another attempt's live session; failed and
        -- completed days remain terminal and never rerun the analysis engine.
        return to_jsonb(t);
    end if;
    perform public.cloud_runner_register(p_user_id, p_runner_id, p_session_id, 60, 30);
    return public.cloud_submit_execution(p_user_id, p_runner_id, p_request_id,
        'composite_analysis', jsonb_build_object('region', p_region));
end;
$$;

revoke all on function public.cloud_submit_daily_execution(uuid, text, uuid, uuid, text)
    from public, anon, authenticated;
grant execute on function public.cloud_submit_daily_execution(uuid, text, uuid, uuid, text)
    to service_role;

commit;
