-- Additive migration. Apply only to the dedicated DSA Supabase project.
begin;

create table public.app_members (
    user_id uuid primary key references auth.users(id),
    enabled boolean not null default true,
    created_at timestamptz not null default now()
);
create table public.watchlists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.app_members(user_id),
    market text not null check (market in ('CN', 'HK', 'US')),
    code text not null check (
        (market = 'CN' and code ~ '^[0-9]{6}$') or
        (market = 'HK' and code ~ '^hk[0-9]{5}$') or
        (market = 'US' and code ~ '^[A-Z][A-Z0-9.\^-]{0,19}$')
    ),
    name text not null default '' check (length(name) <= 100),
    position integer not null default 0,
    created_at timestamptz not null default now(),
    unique(user_id, market, code)
);
create table public.analysis_tasks (
    id uuid primary key,
    user_id uuid not null references public.app_members(user_id),
    content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
    input_snapshot jsonb not null,
    status text not null default 'publishing' check (status in ('publishing', 'publish_failed', 'succeeded', 'cancelled')),
    execution_source text not null default 'python',
    error_code text check (error_code is null or error_code = 'publish_failed'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    unique(id, user_id)
);
create table public.analysis_reports (
    task_id uuid primary key,
    user_id uuid not null,
    title text not null,
    markdown text not null,
    results jsonb not null check (jsonb_typeof(results) = 'array'),
    artifact_version integer not null default 1 check (artifact_version = 1),
    bucket text not null default 'analysis-reports' check (bucket = 'analysis-reports'),
    object_path text not null unique,
    market_as_of timestamptz,
    generated_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    foreign key(task_id, user_id) references public.analysis_tasks(id, user_id),
    check (object_path like user_id::text || '/' || task_id::text || '/%')
);
create index watchlists_user_order on public.watchlists(user_id, position, created_at);
create index tasks_user_created on public.analysis_tasks(user_id, created_at desc);
create index tasks_user_status on public.analysis_tasks(user_id, status, updated_at);
create index reports_user_created on public.analysis_reports(user_id, created_at desc, task_id);

alter table public.app_members enable row level security;
alter table public.watchlists enable row level security;
alter table public.analysis_tasks enable row level security;
alter table public.analysis_reports enable row level security;
revoke all on public.app_members, public.watchlists, public.analysis_tasks, public.analysis_reports from public, anon, authenticated;
grant select on public.app_members, public.watchlists, public.analysis_tasks, public.analysis_reports to authenticated;
grant insert(user_id, market, code, name, position), update(market, code, name, position), delete on public.watchlists to authenticated;
grant all on public.app_members, public.watchlists, public.analysis_tasks, public.analysis_reports to service_role;

create policy member_self on public.app_members for select to authenticated
    using (user_id = (select auth.uid()));
create policy watchlists_owner on public.watchlists for all to authenticated
    using (user_id = (select auth.uid()) and exists (
        select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.enabled
    ))
    with check (user_id = (select auth.uid()) and exists (
        select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.enabled
    ));
create policy tasks_owner_read on public.analysis_tasks for select to authenticated
    using (user_id = (select auth.uid()) and exists (
        select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.enabled
    ));
create policy reports_owner_read on public.analysis_reports for select to authenticated
    using (user_id = (select auth.uid()) and exists (
        select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.enabled
    ));

insert into storage.buckets(id, name, public) values ('analysis-reports', 'analysis-reports', false);
-- A published DB record is the capability; a plausible-looking path is insufficient.
create policy dsa_report_download on storage.objects for select to authenticated using (
    bucket_id = 'analysis-reports' and exists (
        select 1 from public.analysis_reports r where r.object_path = name and r.bucket = bucket_id
          and r.user_id = (select auth.uid())
    )
);
-- Restrictive guards also protect this bucket against unrelated permissive policies.
create policy dsa_storage_read_guard on storage.objects as restrictive for select to authenticated using (
    bucket_id <> 'analysis-reports' or exists (
        select 1 from public.analysis_reports r where r.object_path = name and r.bucket = bucket_id
          and r.user_id = (select auth.uid())
    )
);
create policy dsa_storage_anon_guard on storage.objects as restrictive for select to anon
    using (bucket_id <> 'analysis-reports');
create policy dsa_storage_insert_guard on storage.objects as restrictive for insert to anon, authenticated
    with check (bucket_id <> 'analysis-reports');
create policy dsa_storage_update_guard on storage.objects as restrictive for update to anon, authenticated
    using (bucket_id <> 'analysis-reports') with check (bucket_id <> 'analysis-reports');
create policy dsa_storage_delete_guard on storage.objects as restrictive for delete to anon, authenticated
    using (bucket_id <> 'analysis-reports');

-- Only trusted publishers can call these RPCs. Lock the row before transitions.
create function public.cloud_begin_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_input jsonb)
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
    if t.status = 'succeeded' then return t.status; end if;
    if t.status = 'cancelled' then raise exception 'publication_cancelled'; end if;
    update public.analysis_tasks set status = 'publishing', updated_at = now(), error_code = null where id = p_task_id;
    return 'publishing';
end;
$$;

create function public.cloud_complete_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_payload jsonb, p_path text)
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

create function public.cloud_fail_publish(p_task_id uuid, p_user_id uuid, p_hash text)
returns void language sql security invoker set search_path = '' as $$
    update public.analysis_tasks set status = 'publish_failed', error_code = 'publish_failed', updated_at = now()
    where id = p_task_id and user_id = p_user_id and content_hash = p_hash and status not in ('succeeded', 'cancelled');
$$;
-- Maintenance only: cancellation and the no-report check share the task lock.
-- A late completion can never succeed after cleanup, so published history is safe.
create function public.cloud_cleanup_publish(p_task_id uuid, p_user_id uuid, p_hash text, p_apply boolean)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.analysis_tasks;
begin
    select * into strict t from public.analysis_tasks where id = p_task_id for update;
    if t.user_id <> p_user_id or t.content_hash <> p_hash then
        raise exception 'publication_conflict' using errcode = '23505';
    end if;
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
revoke all on function public.cloud_begin_publish(uuid, uuid, text, jsonb),
    public.cloud_complete_publish(uuid, uuid, text, jsonb, text), public.cloud_fail_publish(uuid, uuid, text),
    public.cloud_cleanup_publish(uuid, uuid, text, boolean)
    from public, anon, authenticated;
grant execute on function public.cloud_begin_publish(uuid, uuid, text, jsonb),
    public.cloud_complete_publish(uuid, uuid, text, jsonb, text), public.cloud_fail_publish(uuid, uuid, text),
    public.cloud_cleanup_publish(uuid, uuid, text, boolean)
    to service_role;
commit;
