-- Live updates use private Broadcast channels named branch:<id>. Messages are only
-- "something changed" signals, and this decides who may listen to a branch.
create function app.can_listen(topic text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from app.memberships m
      join app.branches b on b.tenant_id = m.tenant_id
      join app.tenants t on t.id = m.tenant_id
     where m.user_id = (select auth.uid())
       and m.status = 'active'
       and t.status = 'active'
       and topic = 'branch:' || b.id::text
       and (m.role = 'owner' or exists (
         select 1 from app.branch_memberships bm
          where bm.membership_id = m.id and bm.branch_id = b.id))
  )
$$;

revoke execute on function app.can_listen(text) from public;
grant usage on schema app to authenticated;
grant execute on function app.can_listen(text) to authenticated;

create policy branch_listeners on realtime.messages for select to authenticated
  using (extension = 'broadcast' and (select app.can_listen(realtime.topic())));
