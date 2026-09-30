-- La Parent'elle — booking cancellations
-- Run in the Supabase SQL editor after 001_bookings.sql.

create extension if not exists "pgcrypto";

alter table public.bookings
  add column if not exists client_token uuid,
  add column if not exists staff_token uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text,
  add column if not exists session_snapshot jsonb,
  add column if not exists ics_uid text;

-- Existing rows need unguessable tokens before the NOT NULL constraints.
update public.bookings
  set client_token = gen_random_uuid()
  where client_token is null;
update public.bookings
  set staff_token = gen_random_uuid()
  where staff_token is null;

alter table public.bookings
  alter column client_token set default gen_random_uuid(),
  alter column client_token set not null,
  alter column staff_token set default gen_random_uuid(),
  alter column staff_token set not null;

create unique index if not exists bookings_client_token_key
  on public.bookings (client_token);
create unique index if not exists bookings_staff_token_key
  on public.bookings (staff_token);

-- Availability counts only confirmed bookings.
create index if not exists bookings_active_session_uid_idx
  on public.bookings (session_uid)
  where status = 'confirmed';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_status_check
      check (status in ('confirmed', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bookings_cancelled_by_check'
  ) then
    alter table public.bookings
      add constraint bookings_cancelled_by_check
      check (cancelled_by is null or cancelled_by in ('client', 'staff', 'admin'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bookings_cancellation_state_check'
  ) then
    alter table public.bookings
      add constraint bookings_cancellation_state_check
      check (
        (
          status = 'cancelled'
          and cancelled_at is not null
          and cancelled_by is not null
        ) or (
          status = 'confirmed'
          and cancelled_at is null
          and cancelled_by is null
          and cancel_reason is null
        )
      );
  end if;
end
$$;
