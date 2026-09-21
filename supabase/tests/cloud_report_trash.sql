-- Run only against the dedicated restore project, never production:
--   psql "$SUPABASE_DB_URL" -v owner_user_id=<enabled-A-uuid> \
--     -v other_user_id=<enabled-B-uuid> -f supabase/tests/cloud_report_trash.sql
--
-- The whole suite rolls back.  It needs a database owner connection so it can
-- emulate JWT claims and inspect role privileges; it never reads credentials.
\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(p_sql text, p_sqlstate text, p_message text)
returns void language plpgsql as $$
begin
    begin
        execute p_sql;
    exception when others then
        if sqlstate = p_sqlstate and position(p_message in sqlerrm) > 0 then
            return;
        end if;
        raise;
    end;
    raise exception 'expected % (%)', p_message, p_sqlstate;
end;
$$;

create temporary table trash_test_ids (
    owner_id uuid not null,
    other_id uuid not null,
    deleted_task_id uuid not null,
    publishing_task_id uuid not null,
    active_task_id uuid not null,
    retry_task_id uuid not null,
    runner_session_id uuid not null,
    execution_task_id uuid not null
) on commit drop;

insert into trash_test_ids
select :'owner_user_id'::uuid, :'other_user_id'::uuid,
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid();

do $$
declare
    ids trash_test_ids;
    first_deleted_at timestamptz;
    second_deleted_at timestamptz;
begin
    select * into ids from trash_test_ids;
    if not exists (select 1 from public.app_members where user_id = ids.owner_id and enabled) then
        raise exception 'owner_user_id must be an enabled app member';
    end if;
    if not exists (select 1 from public.app_members where user_id = ids.other_id and enabled) then
        raise exception 'other_user_id must be an enabled app member';
    end if;

    insert into public.analysis_tasks(id, user_id, content_hash, input_snapshot, status)
    values
      (ids.deleted_task_id, ids.owner_id, repeat('a', 64), '{}'::jsonb, 'succeeded'),
      (ids.publishing_task_id, ids.owner_id, repeat('b', 64), '{}'::jsonb, 'publishing'),
      (ids.active_task_id, ids.owner_id, repeat('c', 64), '{}'::jsonb, 'succeeded'),
      (ids.retry_task_id, ids.owner_id, repeat('d', 64), '{}'::jsonb, 'publish_failed');

    insert into public.analysis_reports(task_id, user_id, title, markdown, results, object_path)
    values
      (ids.deleted_task_id, ids.owner_id, 'trash test', '# test', '[]'::jsonb,
       ids.owner_id::text || '/' || ids.deleted_task_id::text || '/report.md'),
      (ids.active_task_id, ids.owner_id, 'active test', '# test', '[]'::jsonb,
       ids.owner_id::text || '/' || ids.active_task_id::text || '/report.md');

    insert into public.runner_status(user_id, runner_id, session_id, online_until)
    values (ids.owner_id, 'trash-test-runner', ids.runner_session_id, now() + interval '5 minutes');
    insert into public.execution_tasks(id, user_id, runner_id, request_id, task_type, input_json,
        status, session_id, claim_deadline, report_id)
    values (ids.execution_task_id, ids.owner_id, 'trash-test-runner', gen_random_uuid(), 'stock_analysis',
        jsonb_build_object('stock_code', '600519'), 'running', ids.runner_session_id,
        now() + interval '5 minutes', ids.active_task_id);

    perform set_config('request.jwt.claim.sub', ids.owner_id::text, true);
    select public.cloud_set_report_deleted(ids.deleted_task_id, true) into first_deleted_at;
    if first_deleted_at is null then raise exception 'delete did not return a timestamp'; end if;
    select public.cloud_set_report_deleted(ids.deleted_task_id, true) into second_deleted_at;
    if second_deleted_at is distinct from first_deleted_at then raise exception 'delete is not idempotent'; end if;
    if not exists (select 1 from public.analysis_reports where task_id = ids.deleted_task_id) then
        raise exception 'delete removed report history';
    end if;
    perform public.cloud_set_report_deleted(ids.deleted_task_id, false);
    if (select deleted_at from public.analysis_tasks where id = ids.deleted_task_id) is not null then
        raise exception 'restore did not clear deleted_at';
    end if;
    if public.cloud_set_report_deleted(ids.deleted_task_id, false) is not null then
        raise exception 'restore is not idempotent';
    end if;

    perform pg_temp.expect_error(
        format('select public.cloud_set_report_deleted(%L::uuid, true)', ids.publishing_task_id),
        'P0001', 'report_publishing');
    perform pg_temp.expect_error(
        format('select public.cloud_set_report_deleted(%L::uuid, true)', ids.active_task_id),
        'P0001', 'report_execution_active');

    perform public.cloud_set_report_deleted(ids.retry_task_id, true);
    perform pg_temp.expect_error(
        format('select public.cloud_begin_publish(%L::uuid, %L::uuid, %L, %L::jsonb)',
            ids.retry_task_id, ids.owner_id, repeat('d', 64), '{}'),
        'P0001', 'report_trashed');
    perform public.cloud_fail_publish(ids.retry_task_id, ids.owner_id, repeat('d', 64));
    if (select deleted_at from public.analysis_tasks where id = ids.retry_task_id) is null then
        raise exception 'publisher retry cleared deleted_at';
    end if;

    perform set_config('request.jwt.claim.sub', ids.other_id::text, true);
    perform pg_temp.expect_error(
        format('select public.cloud_set_report_deleted(%L::uuid, true)', ids.deleted_task_id),
        '42501', 'report_not_owned');

    perform set_config('request.jwt.claim.sub', '', true);
    perform pg_temp.expect_error(
        format('select public.cloud_set_report_deleted(%L::uuid, true)', ids.deleted_task_id),
        '42501', 'member_inactive');

    update public.app_members set enabled = false where user_id = ids.owner_id;
    perform set_config('request.jwt.claim.sub', ids.owner_id::text, true);
    perform pg_temp.expect_error(
        format('select public.cloud_set_report_deleted(%L::uuid, true)', ids.deleted_task_id),
        '42501', 'member_inactive');
end;
$$;

do $$
begin
    if has_table_privilege('authenticated', 'public.analysis_tasks', 'UPDATE')
       or has_table_privilege('anon', 'public.analysis_tasks', 'UPDATE') then
        raise exception 'direct task updates granted to browser roles';
    end if;
    if has_function_privilege('anon', 'public.cloud_set_report_deleted(uuid,boolean)', 'EXECUTE') then
        raise exception 'anonymous trash RPC execution granted';
    end if;
end;
$$;

rollback;
