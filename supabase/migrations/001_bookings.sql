-- La Parent'elle — session bookings
-- Run once in the Supabase SQL editor, then set the env vars
-- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env

create table if not exists public.bookings (
  id          bigint generated always as identity primary key,
  session_uid  text        not null,
  name        text        not null,
  email       text        not null,
  phone       text,
  status      text        not null default 'confirmed',
  created_at  timestamptz not null default now()
);

-- Capacity checks query by session
create index if not exists bookings_session_uid_idx on public.bookings (session_uid);

-- No public access: everything goes through the server (service role key)
alter table public.bookings enable row level security;

-- The service role bypasses RLS but still needs table privileges
-- (missing grants surface as 403 "permission denied for table bookings")
grant all on public.bookings to service_role;
grant usage, select on sequence public.bookings_id_seq to service_role;
