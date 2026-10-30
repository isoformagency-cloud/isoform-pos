-- Enquiries from the marketing site. Separate from all tenant data.
create table public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  business text not null check (char_length(business) between 2 and 120),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  email text not null default '' check (char_length(email) <= 200),
  city text not null check (char_length(city) between 2 and 80),
  outlets text not null check (outlets in ('1', '2 to 5', '6 or more')),
  message text not null default '' check (char_length(message) <= 1000),
  created_at timestamptz not null default now()
);

-- RLS on with no policies: only the server-side function can read or write.
alter table public.demo_requests enable row level security;
