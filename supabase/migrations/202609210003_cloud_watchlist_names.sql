-- Additive, service-only name completion. No task snapshots or reports are changed.
begin;

create function public.cloud_watchlist_name_candidates(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'market', w.market, 'code', w.code, 'name', w.name
    ) order by w.position, w.created_at), '[]'::jsonb)
    from public.watchlists w
    where w.user_id = p_user_id
      and (btrim(w.name, E' \t\r\n') = '' or upper(btrim(w.name, E' \t\r\n')) = upper(w.code))
      and exists (select 1 from public.app_members m where m.user_id = p_user_id and m.enabled);
$$;

create function public.cloud_fill_watchlist_name(
    p_user_id uuid, p_id uuid, p_market text, p_code text, p_old_name text, p_name text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
    if p_name is null or length(btrim(p_name)) not between 1 and 100
       or upper(btrim(p_name)) = upper(p_code) then
        return false;
    end if;
    -- Serialize with membership changes; service_role must not bypass a disabled owner.
    perform 1 from public.app_members where user_id = p_user_id and enabled for share;
    if not found then return false; end if;
    update public.watchlists set name = btrim(p_name)
    where id = p_id and user_id = p_user_id and market = p_market and code = p_code
      and name = p_old_name
      and (btrim(name, E' \t\r\n') = '' or upper(btrim(name, E' \t\r\n')) = upper(code));
    get diagnostics v_count = row_count;
    return v_count = 1;
end;
$$;

revoke all on function public.cloud_watchlist_name_candidates(uuid) from public, anon, authenticated;
revoke all on function public.cloud_fill_watchlist_name(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.cloud_watchlist_name_candidates(uuid) to service_role;
grant execute on function public.cloud_fill_watchlist_name(uuid,uuid,text,text,text,text) to service_role;
commit;
