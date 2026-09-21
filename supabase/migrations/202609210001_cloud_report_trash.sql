-- Recoverable report trash.  Deletion changes only the task visibility marker;
-- reports, storage objects, and execution history remain intact.
begin;

alter table public.analysis_tasks
    add column if not exists deleted_at timestamptz;
create index if not exists tasks_user_deleted_updated
    on public.analysis_tasks(user_id, deleted_at, updated_at desc);

-- Browser clients only receive SELECT on analysis_tasks.  This definer RPC is
-- deliberately the sole authenticated write path for the deletion marker.
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
    if p_task_id is null or p_deleted is null then
        raise exception 'invalid_input';
    end if;

    -- This is also the publication-retry serialization point.  A publisher
    -- either enters publishing first (and archive rejects), or archive marks
    -- first (and every publisher below rejects).
    select * into t from public.analysis_tasks
      where id = p_task_id and user_id = v_user_id
      for update;
    if not found then
        raise exception 'report_not_owned' using errcode = '42501';
    end if;

    if p_deleted then
        if t.status = 'publishing' then
            raise exception 'report_publishing';
        end if;
        -- Lock linked execution rows before deciding.  A running execution is
        -- never moved to the trash; completed history is retained.
        perform 1 from public.execution_tasks
          where user_id = v_user_id and report_id = p_task_id
            and status in ('pending', 'running')
          for update;
        if found then
            raise exception 'report_execution_active';
        end if;
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

-- All trusted publisher transitions lock the same task row and reject a
-- trashed task, so a retry can never make it visible again.
create or replace function public.cloud_begin_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_input jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    if not exists (select 1 from public.app_members where user_id = p_user_id and enabled) then
        raise exception 'member_inactive' using errcode = '42501';
    end if;
    insert into public.analysis_tasks(id, user_id, content_hash, input_snapshot)
        values (p_task_id, p_user_id, p_hash, p_input) on conflict (id) do nothing;
    select * into strict t from public.analysis_tasks where id = p_task_id for update;
    if t.user_id <> p_user_id or t.content_hash <> p_hash or t.input_snapshot <> p_input then
        raise exception 'publication_conflict' using errcode = '23505';
    end if;
    if t.deleted_at is not null then raise exception 'report_trashed'; end if;
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
    if not exists (select 1 from public.app_members where user_id = p_user_id and enabled) then
        raise exception 'member_inactive' using errcode = '42501';
    end if;
    select * into strict t from public.analysis_tasks where id = p_task_id for update;
    if t.user_id <> p_user_id or t.content_hash <> p_hash then
        raise exception 'publication_conflict' using errcode = '23505';
    end if;
    if t.deleted_at is not null then raise exception 'report_trashed'; end if;
    if t.status = 'succeeded' then return t.status; end if;
    if t.status = 'cancelled' then raise exception 'publication_cancelled'; end if;
    if p_path <> p_user_id::text || '/' || p_task_id::text || '/' || p_hash || '.md' then
        raise exception 'invalid_object_path';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'analysis-reports' and name = p_path) then
        raise exception 'attachment_missing';
    end if;
    insert into public.analysis_reports(task_id, user_id, title, markdown, results, object_path, generated_at, market_as_of)
        values (p_task_id, p_user_id, p_payload->>'title', p_payload->>'markdown', p_payload->'results', p_path,
            (p_payload->>'generated_at')::timestamptz, (p_payload->>'market_as_of')::timestamptz);
    update public.analysis_tasks set status = 'succeeded', error_code = null,
        completed_at = now(), updated_at = now() where id = p_task_id;
    return 'succeeded';
end;
$$;

create or replace function public.cloud_fail_publish(p_task_id uuid, p_user_id uuid, p_hash text)
returns void language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    select * into t from public.analysis_tasks
      where id = p_task_id and user_id = p_user_id and content_hash = p_hash
      for update;
    if not found or t.deleted_at is not null then return; end if;
    if t.status not in ('succeeded', 'cancelled') then
        update public.analysis_tasks set status = 'publish_failed', error_code = 'publish_failed', updated_at = now()
          where id = p_task_id;
    end if;
end;
$$;

create or replace function public.cloud_cleanup_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_apply boolean)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    select * into strict t from public.analysis_tasks where id = p_task_id for update;
    if t.user_id <> p_user_id or t.content_hash <> p_hash then
        raise exception 'publication_conflict' using errcode = '23505';
    end if;
    if t.deleted_at is not null then raise exception 'report_trashed'; end if;
    if t.status = 'succeeded' or exists (select 1 from public.analysis_reports where task_id = p_task_id) then
        raise exception 'published_report_cannot_be_cleaned';
    end if;
    if p_apply then
        update public.analysis_tasks set status = 'cancelled', error_code = null,
            completed_at = now(), updated_at = now() where id = p_task_id;
    end if;
    return p_user_id::text || '/' || p_task_id::text || '/' || p_hash || '.md';
end;
$$;

revoke all on function public.cloud_set_report_deleted(uuid, boolean) from public, anon;
grant execute on function public.cloud_set_report_deleted(uuid, boolean) to authenticated;

-- Replacing functions retains existing grants, but restate the publisher trust
-- boundary in this migration for installations that altered defaults.
revoke all on function public.cloud_begin_publish(uuid, uuid, text, jsonb),
    public.cloud_complete_publish(uuid, uuid, text, jsonb, text), public.cloud_fail_publish(uuid, uuid, text),
    public.cloud_cleanup_publish(uuid, uuid, text, boolean)
    from public, anon, authenticated;
grant execute on function public.cloud_begin_publish(uuid, uuid, text, jsonb),
    public.cloud_complete_publish(uuid, uuid, text, jsonb, text), public.cloud_fail_publish(uuid, uuid, text),
    public.cloud_cleanup_publish(uuid, uuid, text, boolean)
    to service_role;
commit;
