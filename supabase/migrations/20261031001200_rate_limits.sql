-- Request limits for public endpoints. They live in the database because each
-- serverless instance has its own memory and cannot count requests alone.
create table app.rate_limits (
  bucket text primary key,
  hits integer not null,
  window_ends timestamptz not null
);

alter table app.rate_limits enable row level security;
alter table app.rate_limits force row level security;

create function app.allow_request(request_bucket text, max_hits integer, window_seconds integer) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare
  used integer;
begin
  insert into app.rate_limits as r (bucket, hits, window_ends)
  values (request_bucket, 1, now() + make_interval(secs => window_seconds))
  on conflict (bucket) do update set
    hits = case when r.window_ends < now() then 1 else r.hits + 1 end,
    window_ends = case when r.window_ends < now() then now() + make_interval(secs => window_seconds) else r.window_ends end
  returning hits into used;
  if random() < 0.01 then
    delete from app.rate_limits where window_ends < now();
  end if;
  return used <= max_hits;
end $$;

revoke execute on function app.allow_request(text, integer, integer) from public;
grant execute on function app.allow_request(text, integer, integer) to app_user;

-- The website's enquiry form reaches this through Supabase's API, using the server-only key.
create function public.allow_demo_request(visitor text) returns boolean
  language sql security definer set search_path = ''
as $$ select app.allow_request('demo:' || visitor, 5, 3600) $$;

revoke execute on function public.allow_demo_request(text) from public, anon, authenticated;
grant execute on function public.allow_demo_request(text) to service_role;
