-- Cloud runner lease and execution queue.  This is intentionally separate from
-- analysis_tasks: that table remains the report publisher's immutable contract.
begin;

create table public.runner_status (
    user_id uuid not null references public.app_members(user_id),
    runner_id text not null check (length(trim(runner_id)) between 1 and 128),
    session_id uuid not null,
    claim_seconds integer not null default 30 check (claim_seconds between 5 and 120),
    online_until timestamptz not null,
    last_seen_at timestamptz not null default now(),
    current_task_id uuid,
    primary key (user_id, runner_id)
);

create table public.execution_tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.app_members(user_id),
    runner_id text not null,
    request_id uuid not null,
    task_type text not null check (task_type = 'stock_analysis'),
    input_json jsonb not null check (jsonb_typeof(input_json) = 'object' and octet_length(input_json::text) <= 65536),
    status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
    session_id uuid,
    claim_deadline timestamptz not null,
    progress integer not null default 0 check (progress between 0 and 100),
    progress_message text not null default '' check (length(progress_message) <= 1000),
    report_id uuid,
    error_code text check (error_code is null or length(error_code) between 1 and 100),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (user_id, runner_id, request_id),
    foreign key (user_id, runner_id) references public.runner_status(user_id, runner_id)
);
create index execution_tasks_claim on public.execution_tasks(user_id, runner_id, status, claim_deadline, created_at);

alter table public.runner_status enable row level security;
alter table public.execution_tasks enable row level security;
revoke all on public.runner_status, public.execution_tasks from public, anon, authenticated;
grant select on public.runner_status, public.execution_tasks to authenticated;
grant all on public.runner_status, public.execution_tasks to service_role;

create policy runner_status_owner_read on public.runner_status for select to authenticated using (
    user_id = (select auth.uid()) and exists (
        select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.enabled
    )
);
create policy execution_tasks_owner_read on public.execution_tasks for select to authenticated using (
    user_id = (select auth.uid()) and exists (
        select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.enabled
    )
);

-- Call only after the runner row was locked.  Keeping this lock first is the
-- global mutation order for runner and execution rows.
create function public.cloud_runner_reconcile_locked(p_user_id uuid, p_runner_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
    update public.execution_tasks
       set status = 'failed', error_code = 'RUNNER_OFFLINE', completed_at = now(), updated_at = now()
     where user_id = p_user_id and runner_id = p_runner_id
       and status in ('pending', 'running')
       and ((status = 'pending' and claim_deadline <= now()) or exists (
           select 1 from public.runner_status r
            where r.user_id = p_user_id and r.runner_id = p_runner_id and r.online_until <= now()
       ));
    update public.runner_status set current_task_id = null
     where user_id = p_user_id and runner_id = p_runner_id and current_task_id is not null and not exists (
         select 1 from public.execution_tasks e
          where e.id = public.runner_status.current_task_id and e.status = 'running'
     );
end;
$$;

create function public.cloud_runner_require_member(p_user_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
    if not exists (select 1 from public.app_members where user_id = p_user_id and enabled) then
        raise exception 'MEMBER_DISABLED' using errcode = '42501';
    end if;
end;
$$;

create function public.cloud_runner_register(p_user_id uuid, p_runner_id text, p_session_id uuid,
    p_online_seconds integer default 60, p_claim_seconds integer default 30)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status;
begin
    if p_session_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    if p_runner_id is null or length(trim(p_runner_id)) not between 1 and 128 or p_session_id is null
       or p_online_seconds is null or p_claim_seconds is null
       or p_online_seconds not between 15 and 300 or p_claim_seconds not between 5 and 120 then
        raise exception 'INVALID_INPUT';
    end if;
    select * into r from public.runner_status where user_id = p_user_id and runner_id = p_runner_id for update;
    if found then
        perform public.cloud_runner_reconcile_locked(p_user_id, p_runner_id);
        select * into r from public.runner_status where user_id = p_user_id and runner_id = p_runner_id;
        if r.online_until > now() then
            if r.session_id <> p_session_id then raise exception 'RUNNER_BUSY'; end if;
            update public.runner_status set claim_seconds = p_claim_seconds, online_until = now() + make_interval(secs => p_online_seconds),
                last_seen_at = now() where user_id = p_user_id and runner_id = p_runner_id;
        else
            if r.session_id = p_session_id then raise exception 'RUNNER_STALE'; end if;
            update public.runner_status set session_id = p_session_id, claim_seconds = p_claim_seconds,
                online_until = now() + make_interval(secs => p_online_seconds), last_seen_at = now(), current_task_id = null
              where user_id = p_user_id and runner_id = p_runner_id;
        end if;
    else
        insert into public.runner_status(user_id, runner_id, session_id, claim_seconds, online_until)
            values (p_user_id, p_runner_id, p_session_id, p_claim_seconds, now() + make_interval(secs => p_online_seconds));
    end if;
    return public.cloud_runner_snapshot(p_user_id, p_runner_id);
end;
$$;

create function public.cloud_runner_heartbeat(p_user_id uuid, p_runner_id text, p_session_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status;
begin
    if p_session_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    select * into r from public.runner_status where user_id = p_user_id and runner_id = p_runner_id for update;
    if not found then raise exception 'RUNNER_OFFLINE'; end if;
    perform public.cloud_runner_reconcile_locked(p_user_id, p_runner_id);
    if r.session_id <> p_session_id or r.online_until <= now() then raise exception 'RUNNER_STALE'; end if;
    update public.runner_status set online_until = now() + (r.online_until - r.last_seen_at), last_seen_at = now()
      where user_id = p_user_id and runner_id = p_runner_id;
    return public.cloud_runner_snapshot(p_user_id, p_runner_id);
end;
$$;

create function public.cloud_runner_stop(p_user_id uuid, p_runner_id text, p_session_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status;
begin
    if p_session_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    select * into strict r from public.runner_status where user_id = p_user_id and runner_id = p_runner_id for update;
    if r.session_id <> p_session_id or r.online_until <= now() then raise exception 'RUNNER_STALE'; end if;
    update public.runner_status set online_until = now(), last_seen_at = now() where user_id = p_user_id and runner_id = p_runner_id;
    perform public.cloud_runner_reconcile_locked(p_user_id, p_runner_id);
    return public.cloud_runner_snapshot(p_user_id, p_runner_id);
end;
$$;

create function public.cloud_runner_snapshot(p_user_id uuid, p_runner_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status;
begin
    perform public.cloud_runner_require_member(p_user_id);
    select * into r from public.runner_status where user_id = p_user_id and runner_id = p_runner_id for update;
    if not found then return jsonb_build_object('online', false, 'busy', false, 'last_seen_at', null, 'current_task_id', null); end if;
    perform public.cloud_runner_reconcile_locked(p_user_id, p_runner_id);
    select * into r from public.runner_status where user_id = p_user_id and runner_id = p_runner_id;
    return jsonb_build_object('online', r.online_until > now(), 'busy', exists (
        select 1 from public.execution_tasks e where e.user_id=p_user_id and e.runner_id=p_runner_id and e.status in ('pending','running')
    ),
        'last_seen_at', r.last_seen_at, 'current_task_id', r.current_task_id);
end;
$$;

create function public.cloud_submit_execution(p_user_id uuid, p_runner_id text, p_request_id uuid,
    p_task_type text, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status; t public.execution_tasks;
begin
    if p_request_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    if p_task_type is null or p_task_type <> 'stock_analysis' or p_input is null or jsonb_typeof(p_input) <> 'object'
       or octet_length(p_input::text) > 65536 or (select count(*) from jsonb_object_keys(p_input)) <> 1
       or not (p_input ? 'stock_code') or jsonb_typeof(p_input->'stock_code') <> 'string'
       or (p_input->>'stock_code') !~ '^(?:[0-9]{6}|hk[0-9]{5}|[A-Z][A-Z0-9.^-]{0,19})$' then raise exception 'INVALID_INPUT'; end if;
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

create function public.cloud_claim_execution(p_user_id uuid, p_runner_id text, p_session_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status; t public.execution_tasks;
begin
    if p_session_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    select * into strict r from public.runner_status where user_id=p_user_id and runner_id=p_runner_id for update;
    perform public.cloud_runner_reconcile_locked(p_user_id,p_runner_id);
    -- A claim is a polling operation: return no work so expiry reconciliation
    -- commits instead of being rolled back with a stale-session exception.
    if r.session_id <> p_session_id or r.online_until <= now() then return null; end if;
    if r.current_task_id is not null then return null; end if;
    select * into t from public.execution_tasks where user_id=p_user_id and runner_id=p_runner_id and session_id=p_session_id and status='pending' and claim_deadline > now()
      order by created_at for update skip locked limit 1;
    if not found then return null; end if;
    update public.execution_tasks set status='running',updated_at=now() where id=t.id returning * into t;
    update public.runner_status set current_task_id=t.id where user_id=p_user_id and runner_id=p_runner_id;
    return to_jsonb(t);
end;
$$;

create function public.cloud_progress_execution(p_user_id uuid, p_runner_id text, p_session_id uuid,
    p_task_id uuid, p_progress integer, p_message text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status; t public.execution_tasks;
begin
    if p_session_id is null or p_task_id is null or p_progress is null or p_progress not between 0 and 100
       or length(coalesce(p_message,'')) > 1000 then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    select * into strict r from public.runner_status where user_id=p_user_id and runner_id=p_runner_id for update;
    perform public.cloud_runner_reconcile_locked(p_user_id,p_runner_id);
    select * into strict t from public.execution_tasks where id=p_task_id for update;
    if r.session_id <> p_session_id or r.online_until <= now() or r.current_task_id <> p_task_id
       or t.user_id <> p_user_id or t.runner_id <> p_runner_id or t.session_id <> p_session_id or t.status <> 'running' then raise exception 'TASK_NOT_OWNED'; end if;
    update public.execution_tasks set progress=p_progress,progress_message=coalesce(p_message,''),updated_at=now() where id=p_task_id returning * into t;
    return to_jsonb(t);
end;
$$;

create function public.cloud_finish_execution(p_user_id uuid, p_runner_id text, p_session_id uuid,
    p_task_id uuid, p_report_id uuid default null, p_error_code text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status; t public.execution_tasks;
begin
    if p_session_id is null or p_task_id is null then raise exception 'INVALID_INPUT'; end if;
    perform public.cloud_runner_require_member(p_user_id);
    if (p_report_id is null and p_error_code is null) or (p_report_id is not null and p_error_code is not null)
       or (p_error_code is not null and (length(p_error_code) not between 1 and 100)) then raise exception 'INVALID_INPUT'; end if;
    select * into strict r from public.runner_status where user_id=p_user_id and runner_id=p_runner_id for update;
    perform public.cloud_runner_reconcile_locked(p_user_id,p_runner_id);
    select * into strict t from public.execution_tasks where id=p_task_id for update;
    if t.user_id <> p_user_id or t.runner_id <> p_runner_id or t.session_id <> p_session_id then raise exception 'TASK_NOT_OWNED'; end if;
    if (t.status = 'succeeded' and t.report_id = p_report_id and p_error_code is null)
       or (t.status = 'failed' and t.report_id is null and t.error_code = p_error_code and p_report_id is null) then return to_jsonb(t); end if;
    if r.session_id <> p_session_id or r.online_until <= now() or r.current_task_id <> p_task_id or t.status <> 'running' then raise exception 'TASK_NOT_OWNED'; end if;
    if p_report_id is not null and not exists (select 1 from public.analysis_reports where task_id=p_report_id and user_id=p_user_id) then raise exception 'REPORT_NOT_OWNED'; end if;
    update public.execution_tasks set status=case when p_report_id is null then 'failed' else 'succeeded' end,
        report_id=p_report_id,error_code=p_error_code,progress=case when p_report_id is null then progress else 100 end,
        completed_at=now(),updated_at=now() where id=p_task_id returning * into t;
    update public.runner_status set current_task_id=null where user_id=p_user_id and runner_id=p_runner_id;
    return to_jsonb(t);
end;
$$;

-- The report ledger and execution lease must cross their success boundary in
-- one transaction.  A stale worker may upload an object, but cannot publish it.
create function public.cloud_complete_runner_publish(p_user_id uuid, p_runner_id text, p_session_id uuid,
    p_task_id uuid, p_report_id uuid, p_hash text, p_payload jsonb, p_path text)
returns text language plpgsql security invoker set search_path = '' as $$
declare r public.runner_status; t public.execution_tasks; publish_status text;
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
    if r.session_id <> p_session_id or r.online_until <= now() or r.current_task_id <> p_task_id or t.status <> 'running' then
        raise exception 'TASK_NOT_OWNED';
    end if;
    publish_status := public.cloud_complete_publish(p_report_id, p_user_id, p_hash, p_payload, p_path);
    if publish_status <> 'succeeded' then raise exception 'PUBLISH_INCOMPLETE'; end if;
    perform public.cloud_finish_execution(p_user_id, p_runner_id, p_session_id, p_task_id, p_report_id, null);
    return 'succeeded';
end;
$$;

revoke all on function public.cloud_runner_reconcile_locked(uuid,text), public.cloud_runner_require_member(uuid),
 public.cloud_runner_register(uuid,text,uuid,integer,integer), public.cloud_runner_heartbeat(uuid,text,uuid),
 public.cloud_runner_stop(uuid,text,uuid), public.cloud_runner_snapshot(uuid,text),
 public.cloud_submit_execution(uuid,text,uuid,text,jsonb), public.cloud_claim_execution(uuid,text,uuid),
 public.cloud_progress_execution(uuid,text,uuid,uuid,integer,text), public.cloud_finish_execution(uuid,text,uuid,uuid,uuid,text),
 public.cloud_complete_runner_publish(uuid,text,uuid,uuid,uuid,text,jsonb,text)
 from public, anon, authenticated;
grant execute on function public.cloud_runner_reconcile_locked(uuid,text), public.cloud_runner_require_member(uuid),
 public.cloud_runner_register(uuid,text,uuid,integer,integer), public.cloud_runner_heartbeat(uuid,text,uuid),
 public.cloud_runner_stop(uuid,text,uuid), public.cloud_runner_snapshot(uuid,text), public.cloud_submit_execution(uuid,text,uuid,text,jsonb),
 public.cloud_claim_execution(uuid,text,uuid), public.cloud_progress_execution(uuid,text,uuid,uuid,integer,text), public.cloud_finish_execution(uuid,text,uuid,uuid,uuid,text),
 public.cloud_complete_runner_publish(uuid,text,uuid,uuid,uuid,text,jsonb,text)
 to service_role;
commit;
