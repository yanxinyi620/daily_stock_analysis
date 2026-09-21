-- Run only against the dedicated restore project, never production:
--   psql "$SUPABASE_DB_URL" -v owner_user_id=<enabled-A-uuid> \
--     -v other_user_id=<enabled-B-uuid> -f supabase/tests/cloud_report_purge.sql
-- The test records are rolled back and this file does not read credentials.
\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(p_sql text, p_sqlstate text, p_message text)
returns void language plpgsql as $$
begin
    begin execute p_sql;
    exception when others then
        if sqlstate = p_sqlstate and position(p_message in sqlerrm) > 0 then return; end if;
        raise;
    end;
    raise exception 'expected % (%)', p_message, p_sqlstate;
end;
$$;

create temporary table purge_test_ids (
    owner_id uuid not null, other_id uuid not null,
    report_task_id uuid not null, missing_task_id uuid not null,
    retry_task_id uuid not null, active_task_id uuid not null,
    execution_id uuid not null, runner_session_id uuid not null
) on commit drop;
insert into purge_test_ids
select :'owner_user_id'::uuid, :'other_user_id'::uuid,
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid();

do $$
declare
    ids purge_test_ids;
    v_begin jsonb;
    v_repeat jsonb;
    v_finish jsonb;
begin
    select * into ids from purge_test_ids;
    if not exists (select 1 from public.app_members where user_id = ids.owner_id and enabled) then
        raise exception 'owner_user_id must be an enabled app member';
    end if;
    if not exists (select 1 from public.app_members where user_id = ids.other_id and enabled) then
        raise exception 'other_user_id must be an enabled app member';
    end if;

    insert into public.analysis_tasks(id, user_id, content_hash, input_snapshot, status, deleted_at)
    values
      (ids.report_task_id, ids.owner_id, repeat('a', 64), '{}'::jsonb, 'succeeded', now()),
      (ids.missing_task_id, ids.owner_id, repeat('b', 64), '{}'::jsonb, 'succeeded', now()),
      (ids.retry_task_id, ids.owner_id, repeat('c', 64), '{}'::jsonb, 'publish_failed', now()),
      (ids.active_task_id, ids.owner_id, repeat('d', 64), '{}'::jsonb, 'succeeded', now());
    insert into public.analysis_reports(task_id, user_id, title, markdown, results, object_path)
    values (ids.report_task_id, ids.owner_id, 'purge test', '# test', '[]'::jsonb,
            ids.owner_id::text || '/' || ids.report_task_id::text || '/historical/report-v1.md');

    -- Begin is idempotent and makes the report unreadable before Storage work.
    select public.cloud_begin_report_purge(ids.owner_id, ids.report_task_id) into v_begin;
    select public.cloud_begin_report_purge(ids.owner_id, ids.report_task_id) into v_repeat;
    if v_begin->>'purged' <> 'false' or v_repeat <> v_begin
       or v_begin->>'object_path' <> ids.owner_id::text || '/' || ids.report_task_id::text || '/historical/report-v1.md' then
        raise exception 'begin purge is not idempotent';
    end if;
    if (select purge_started_at from public.analysis_tasks where id = ids.report_task_id) is null then
        raise exception 'begin did not set purge_started_at';
    end if;
    -- The report policy is also the capability checked by the attachment
    -- policies, so an authenticated owner loses reads before Storage removal.
    perform set_config('request.jwt.claim.sub', ids.owner_id::text, true);
    execute 'set local role authenticated';
    if exists (select 1 from public.analysis_reports where task_id = ids.report_task_id) then
        raise exception 'purging report remains readable through RLS';
    end if;
    execute 'reset role';

    -- Restore racing after begin must lose; publisher retries cannot revive it.
    perform pg_temp.expect_error(
        format('select public.cloud_set_report_deleted(%L::uuid, false)', ids.report_task_id),
        'P0001', 'report_purge_started');
    perform pg_temp.expect_error(
        format('select public.cloud_begin_publish(%L::uuid, %L::uuid, %L, %L::jsonb)',
            ids.retry_task_id, ids.owner_id, repeat('c', 64), '{}'),
        'P0001', 'report_trashed');
    perform public.cloud_fail_publish(ids.retry_task_id, ids.owner_id, repeat('c', 64));
    if (select deleted_at from public.analysis_tasks where id = ids.retry_task_id) is null then
        raise exception 'publisher retry revived trashed task';
    end if;

    -- A deleted task with no report still gives Storage a deterministic path.
    if (public.cloud_begin_report_purge(ids.owner_id, ids.missing_task_id)->>'object_path') <>
       ids.owner_id::text || '/' || ids.missing_task_id::text || '/' || repeat('b', 64) || '.md' then
        raise exception 'missing report path is not deterministic';
    end if;

    insert into public.runner_status(user_id, runner_id, session_id, online_until)
    values (ids.owner_id, 'purge-test-runner', ids.runner_session_id, now() + interval '5 minutes');
    insert into public.execution_tasks(id, user_id, runner_id, request_id, task_type, input_json,
        status, session_id, claim_deadline, report_id)
    values (ids.execution_id, ids.owner_id, 'purge-test-runner', gen_random_uuid(), 'stock_analysis',
        jsonb_build_object('stock_code', '600519'), 'running', ids.runner_session_id,
        now() + interval '5 minutes', ids.active_task_id);
    perform pg_temp.expect_error(
        format('select public.cloud_begin_report_purge(%L::uuid, %L::uuid)', ids.owner_id, ids.active_task_id),
        'P0001', 'report_execution_active');

    select public.cloud_finish_report_purge(ids.owner_id, ids.report_task_id) into v_finish;
    if v_finish->>'purged' <> 'true' or exists (select 1 from public.analysis_reports where task_id = ids.report_task_id) then
        raise exception 'finish did not delete the report row';
    end if;
    if (select purged_at from public.analysis_tasks where id = ids.report_task_id) is null then
        raise exception 'finish did not retain a task tombstone';
    end if;
    if (public.cloud_begin_report_purge(ids.owner_id, ids.report_task_id)->>'purged') <> 'true'
       or (public.cloud_finish_report_purge(ids.owner_id, ids.report_task_id)->>'purged') <> 'true' then
        raise exception 'completed purge is not idempotent';
    end if;

    perform pg_temp.expect_error(
        format('select public.cloud_begin_report_purge(%L::uuid, %L::uuid)', ids.other_id, ids.report_task_id),
        '42501', 'report_not_owned');
    update public.app_members set enabled = false where user_id = ids.owner_id;
    perform pg_temp.expect_error(
        format('select public.cloud_begin_report_purge(%L::uuid, %L::uuid)', ids.owner_id, ids.missing_task_id),
        '42501', 'member_inactive');
end;
$$;

do $$
begin
    if has_function_privilege('authenticated', 'public.cloud_begin_report_purge(uuid,uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.cloud_begin_report_purge(uuid,uuid)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.cloud_finish_report_purge(uuid,uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.cloud_finish_report_purge(uuid,uuid)', 'EXECUTE') then
        raise exception 'browser purge RPC execution granted';
    end if;
    if has_table_privilege('authenticated', 'public.analysis_tasks', 'UPDATE')
       or has_table_privilege('anon', 'public.analysis_tasks', 'UPDATE') then
        raise exception 'browser task purge flag updates granted';
    end if;
end;
$$;

rollback;
