-- Permanent report deletion is two phase: the trusted API first makes the
-- report unreadable, removes its Storage object, then records the tombstone.
begin;

alter table public.analysis_tasks
    add column if not exists purge_started_at timestamptz,
    add column if not exists purged_at timestamptz;

-- A report row remains the storage read capability.  Once purge begins, revoke
-- both report and attachment reads before the API attempts Storage removal.
drop policy if exists reports_owner_read on public.analysis_reports;
create policy reports_owner_read on public.analysis_reports for select to authenticated
    using (
        user_id = (select auth.uid())
        and exists (
            select 1 from public.app_members m
             where m.user_id = (select auth.uid()) and m.enabled
        )
        and exists (
            select 1 from public.analysis_tasks t
             where t.id = task_id and t.user_id = (select auth.uid())
               and t.purge_started_at is null
        )
    );

-- Keep task tombstones readable to their owner; clients use the purge flags to
-- suppress dangling report links while their normal records query filters them.
drop policy if exists tasks_owner_read on public.analysis_tasks;
create policy tasks_owner_read on public.analysis_tasks for select to authenticated
    using (
        user_id = (select auth.uid())
        and exists (
            select 1 from public.app_members m
             where m.user_id = (select auth.uid()) and m.enabled
        )
    );

create or replace function public.cloud_begin_report_purge(p_user_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    t public.analysis_tasks;
    r public.analysis_reports;
    v_bucket text := 'analysis-reports';
    v_path text;
begin
    if p_user_id is null or p_task_id is null then
        raise exception 'invalid_input';
    end if;
    if not exists (select 1 from public.app_members where user_id = p_user_id and enabled) then
        raise exception 'member_inactive' using errcode = '42501';
    end if;

    -- This is the same report-ledger serialization point used by publishers.
    select * into t from public.analysis_tasks
      where id = p_task_id and user_id = p_user_id
      for update;
    if not found then
        raise exception 'report_not_owned' using errcode = '42501';
    end if;
    if t.deleted_at is null then
        raise exception 'report_not_trashed';
    end if;
    -- A completed tombstone has no report row.  Return its canonical path
    -- without consulting mutable execution state so caller retries are safe.
    if t.purged_at is not null then
        v_path := p_user_id::text || '/' || p_task_id::text || '/' || t.content_hash || '.md';
        return jsonb_build_object('purged', true, 'bucket', v_bucket, 'object_path', v_path);
    end if;
    if t.status = 'publishing' then
        raise exception 'report_publishing';
    end if;

    -- Lock linked executions after the report task.  A runner completing one
    -- cannot cross the report publication boundary while purge is deciding.
    perform 1 from public.execution_tasks
      where user_id = p_user_id and report_id = p_task_id
        and status in ('pending', 'running')
      for update;
    if found then
        raise exception 'report_execution_active';
    end if;

    select * into r from public.analysis_reports
      where task_id = p_task_id and user_id = p_user_id;
    if found then
        v_bucket := r.bucket;
        v_path := r.object_path;
    else
        v_path := p_user_id::text || '/' || p_task_id::text || '/' || t.content_hash || '.md';
    end if;
    if v_bucket <> 'analysis-reports'
       or v_path not like p_user_id::text || '/' || p_task_id::text || '/%' then
        raise exception 'invalid_object_path';
    end if;

    if t.purge_started_at is null then
        update public.analysis_tasks
           set purge_started_at = now(), updated_at = now()
         where id = p_task_id;
    end if;
    return jsonb_build_object('purged', false, 'bucket', v_bucket, 'object_path', v_path);
end;
$$;

create or replace function public.cloud_finish_report_purge(p_user_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    t public.analysis_tasks;
    r public.analysis_reports;
    v_bucket text := 'analysis-reports';
    v_path text;
begin
    if p_user_id is null or p_task_id is null then
        raise exception 'invalid_input';
    end if;
    if not exists (select 1 from public.app_members where user_id = p_user_id and enabled) then
        raise exception 'member_inactive' using errcode = '42501';
    end if;
    select * into t from public.analysis_tasks
      where id = p_task_id and user_id = p_user_id
      for update;
    if not found then
        raise exception 'report_not_owned' using errcode = '42501';
    end if;
    if t.deleted_at is null then
        raise exception 'report_not_trashed';
    end if;
    if t.purge_started_at is null then
        raise exception 'report_purge_not_started';
    end if;

    select * into r from public.analysis_reports
      where task_id = p_task_id and user_id = p_user_id;
    if found then
        v_bucket := r.bucket;
        v_path := r.object_path;
    else
        v_path := p_user_id::text || '/' || p_task_id::text || '/' || t.content_hash || '.md';
    end if;
    if v_bucket <> 'analysis-reports'
       or v_path not like p_user_id::text || '/' || p_task_id::text || '/%' then
        raise exception 'invalid_object_path';
    end if;
    if t.purged_at is not null then
        return jsonb_build_object('purged', true, 'bucket', v_bucket, 'object_path', v_path);
    end if;

    if exists (select 1 from storage.objects where bucket_id = v_bucket and name = v_path) then
        raise exception 'report_attachment_exists';
    end if;

    delete from public.analysis_reports where task_id = p_task_id and user_id = p_user_id;
    -- Keep the existing immutable publisher identity as a tombstone.  All
    -- trusted publisher transitions below reject any started purge.
    update public.analysis_tasks
       set purged_at = now(), status = 'cancelled', error_code = null, updated_at = now()
     where id = p_task_id;
    return jsonb_build_object('purged', true, 'bucket', v_bucket, 'object_path', v_path);
end;
$$;

create or replace function public.cloud_set_report_deleted(p_task_id uuid, p_deleted boolean)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
    v_user_id uuid := auth.uid();
    t public.analysis_tasks;
begin
    if v_user_id is null or not exists (
        select 1 from public.app_members where user_id = v_user_id and enabled
    ) then
        raise exception 'member_inactive' using errcode = '42501';
    end if;
    if p_task_id is null or p_deleted is null then raise exception 'invalid_input'; end if;
    select * into t from public.analysis_tasks
      where id = p_task_id and user_id = v_user_id for update;
    if not found then raise exception 'report_not_owned' using errcode = '42501'; end if;
    if not p_deleted and (t.purge_started_at is not null or t.purged_at is not null) then
        raise exception 'report_purge_started';
    end if;
    if p_deleted then
        if t.status = 'publishing' then raise exception 'report_publishing'; end if;
        perform 1 from public.execution_tasks
          where user_id = v_user_id and report_id = p_task_id
            and status in ('pending', 'running') for update;
        if found then raise exception 'report_execution_active'; end if;
        if t.deleted_at is null then
            update public.analysis_tasks set deleted_at = now(), updated_at = now()
              where id = p_task_id returning deleted_at into t.deleted_at;
        end if;
    elsif t.deleted_at is not null then
        update public.analysis_tasks set deleted_at = null, updated_at = now()
          where id = p_task_id returning deleted_at into t.deleted_at;
    end if;
    return t.deleted_at;
end;
$$;

-- A begun purge is terminal for every publisher and retry entry point.
create or replace function public.cloud_begin_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_input jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    if not exists (select 1 from public.app_members where user_id = p_user_id and enabled) then raise exception 'member_inactive' using errcode = '42501'; end if;
    insert into public.analysis_tasks(id, user_id, content_hash, input_snapshot) values (p_task_id, p_user_id, p_hash, p_input) on conflict (id) do nothing;
    select * into strict t from public.analysis_tasks where id = p_task_id for update;
    if t.user_id <> p_user_id or t.content_hash <> p_hash or t.input_snapshot <> p_input then raise exception 'publication_conflict' using errcode = '23505'; end if;
    if t.deleted_at is not null or t.purge_started_at is not null or t.purged_at is not null then raise exception 'report_trashed'; end if;
    if t.status = 'succeeded' then return t.status; end if;
    if t.status = 'cancelled' then raise exception 'publication_cancelled'; end if;
    update public.analysis_tasks set status = 'publishing', updated_at = now(), error_code = null where id = p_task_id;
    return 'publishing';
end;
$$;

create or replace function public.cloud_complete_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_payload jsonb, p_path text)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    if not exists (select 1 from public.app_members where user_id = p_user_id and enabled) then raise exception 'member_inactive' using errcode = '42501'; end if;
    select * into strict t from public.analysis_tasks where id = p_task_id for update;
    if t.user_id <> p_user_id or t.content_hash <> p_hash then raise exception 'publication_conflict' using errcode = '23505'; end if;
    if t.deleted_at is not null or t.purge_started_at is not null or t.purged_at is not null then raise exception 'report_trashed'; end if;
    if t.status = 'succeeded' then return t.status; end if;
    if t.status = 'cancelled' then raise exception 'publication_cancelled'; end if;
    if p_path <> p_user_id::text || '/' || p_task_id::text || '/' || p_hash || '.md' then raise exception 'invalid_object_path'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'analysis-reports' and name = p_path) then raise exception 'attachment_missing'; end if;
    insert into public.analysis_reports(task_id, user_id, title, markdown, results, object_path, generated_at, market_as_of) values (p_task_id, p_user_id, p_payload->>'title', p_payload->>'markdown', p_payload->'results', p_path, (p_payload->>'generated_at')::timestamptz, (p_payload->>'market_as_of')::timestamptz);
    update public.analysis_tasks set status = 'succeeded', error_code = null, completed_at = now(), updated_at = now() where id = p_task_id;
    return 'succeeded';
end;
$$;

create or replace function public.cloud_fail_publish(p_task_id uuid, p_user_id uuid, p_hash text)
returns void language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    select * into t from public.analysis_tasks where id = p_task_id and user_id = p_user_id and content_hash = p_hash for update;
    if not found or t.deleted_at is not null or t.purge_started_at is not null or t.purged_at is not null then return; end if;
    if t.status not in ('succeeded', 'cancelled') then update public.analysis_tasks set status = 'publish_failed', error_code = 'publish_failed', updated_at = now() where id = p_task_id; end if;
end;
$$;

create or replace function public.cloud_cleanup_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_apply boolean)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    select * into strict t from public.analysis_tasks where id = p_task_id for update;
    if t.user_id <> p_user_id or t.content_hash <> p_hash then raise exception 'publication_conflict' using errcode = '23505'; end if;
    if t.deleted_at is not null or t.purge_started_at is not null or t.purged_at is not null then raise exception 'report_trashed'; end if;
    if t.status = 'succeeded' or exists (select 1 from public.analysis_reports where task_id = p_task_id) then raise exception 'published_report_cannot_be_cleaned'; end if;
    if p_apply then update public.analysis_tasks set status = 'cancelled', error_code = null, completed_at = now(), updated_at = now() where id = p_task_id; end if;
    return p_user_id::text || '/' || p_task_id::text || '/' || p_hash || '.md';
end;
$$;

revoke all on function public.cloud_begin_report_purge(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cloud_finish_report_purge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cloud_begin_report_purge(uuid, uuid) to service_role;
grant execute on function public.cloud_finish_report_purge(uuid, uuid) to service_role;
revoke all on function public.cloud_set_report_deleted(uuid, boolean) from public, anon;
grant execute on function public.cloud_set_report_deleted(uuid, boolean) to authenticated;
revoke all on function public.cloud_begin_publish(uuid, uuid, text, jsonb), public.cloud_complete_publish(uuid, uuid, text, jsonb, text), public.cloud_fail_publish(uuid, uuid, text), public.cloud_cleanup_publish(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.cloud_begin_publish(uuid, uuid, text, jsonb), public.cloud_complete_publish(uuid, uuid, text, jsonb, text), public.cloud_fail_publish(uuid, uuid, text), public.cloud_cleanup_publish(uuid, uuid, text, boolean) to service_role;
commit;
