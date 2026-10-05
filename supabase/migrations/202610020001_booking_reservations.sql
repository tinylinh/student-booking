create extension if not exists btree_gist with schema extensions;

create table public.booking_rooms (
  id text primary key,
  name text not null,
  category text not null check (category in ('Meeting room', 'Library', 'Study room')),
  building text not null,
  floor text not null,
  facilities text[] not null default '{}',
  capacity integer not null check (capacity > 0),
  booking_mode text not null check (booking_mode in ('whole-room', 'seat')),
  hourly_rate integer not null check (hourly_rate >= 0),
  is_active boolean not null default true
);

insert into public.booking_rooms (id, name, category, building, floor, facilities, capacity, booking_mode, hourly_rate)
values
  ('meeting-10', 'Meeting Room 10', 'Meeting room', 'Meeting Center', '1st floor', array['Wi-Fi', 'Display', 'Air conditioning'], 10, 'whole-room', 80000),
  ('meeting-20', 'Meeting Room 20', 'Meeting room', 'Meeting Center', '2nd floor', array['Wi-Fi', 'Projector', 'Air conditioning'], 20, 'whole-room', 120000),
  ('meeting-40', 'Meeting Room 40', 'Meeting room', 'Meeting Center', '3rd floor', array['Wi-Fi', 'Projector', 'Video conferencing'], 40, 'whole-room', 200000),
  ('library-main', 'Library Reading Hall', 'Library', 'Main Library', '2nd floor', array['Wi-Fi', 'Power outlets', 'Quiet zone'], 36, 'seat', 5000),
  ('study-hall', 'Quiet Study Hall', 'Study room', 'Learning Center', '1st floor', array['Wi-Fi', 'Power outlets', 'Silent zone'], 24, 'seat', 8000)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  building = excluded.building,
  floor = excluded.floor,
  facilities = excluded.facilities,
  capacity = excluded.capacity,
  booking_mode = excluded.booking_mode,
  hourly_rate = excluded.hourly_rate;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  payment_reference text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id text not null references public.booking_rooms(id),
  booking_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_hours smallint not null check (duration_hours between 1 and 8),
  total_amount integer not null check (total_amount >= 0),
  status text not null check (status in ('awaiting_payment', 'awaiting_verification', 'confirmed', 'cancelled', 'expired')),
  customer_name text,
  customer_email text,
  customer_phone text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index bookings_user_created_idx on public.bookings (user_id, created_at desc);

create table public.booking_resources (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  room_id text not null references public.booking_rooms(id),
  booking_date date not null,
  resource_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('held', 'awaiting_verification', 'confirmed', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status = 'held' and hold_expires_at is not null) or status <> 'held'),
  constraint booking_resources_no_overlap
    exclude using gist (
      room_id with =,
      resource_id with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    ) where (status in ('held', 'awaiting_verification', 'confirmed'))
);

create index booking_resources_room_date_idx
  on public.booking_resources (room_id, booking_date, status);
create index booking_resources_hold_expiry_idx
  on public.booking_resources (hold_expires_at)
  where status = 'held';

alter table public.booking_rooms enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_resources enable row level security;
alter table public.bookings replica identity full;
alter table public.booking_resources replica identity full;

create policy "Authenticated users can read active room catalog"
  on public.booking_rooms for select to authenticated using (is_active);

create policy "Users can read their own bookings"
  on public.bookings for select to authenticated using (user_id = (select auth.uid()));

create policy "Authenticated users can read resource availability"
  on public.booking_resources for select to authenticated using (
    (status = 'held' and hold_expires_at > now())
    or status in ('awaiting_verification', 'confirmed')
  );

grant select on public.booking_rooms, public.bookings, public.booking_resources to authenticated;
revoke insert, update, delete on public.booking_rooms, public.bookings, public.booking_resources from anon, authenticated;

create or replace function public.hold_booking_resources(
  p_room_id text,
  p_booking_date date,
  p_start_time time without time zone,
  p_duration_hours integer,
  p_resource_ids text[],
  p_replace_booking_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.booking_rooms%rowtype;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_hold_expires_at timestamptz := now() + interval '15 minutes';
  v_booking_id uuid;
  v_payment_reference text;
  v_total_amount integer;
  v_resource_count integer;
  v_input_count integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_duration_hours is null or p_duration_hours not between 1 and 8 then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;
  if p_resource_ids is null or cardinality(p_resource_ids) = 0 then
    raise exception 'RESOURCE_REQUIRED' using errcode = '22023';
  end if;

  select * into v_room
  from public.booking_rooms
  where id = p_room_id and is_active;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(distinct resource_id), count(*)
  into v_resource_count, v_input_count
  from unnest(p_resource_ids) as requested(resource_id);
  if v_resource_count <> v_input_count then
    raise exception 'DUPLICATE_RESOURCE' using errcode = '22023';
  end if;

  if v_room.booking_mode = 'whole-room' then
    if cardinality(p_resource_ids) <> 1 or p_resource_ids[1] <> 'ROOM' then
      raise exception 'WHOLE_ROOM_REQUIRED' using errcode = '22023';
    end if;
  else
    if exists (
      select 1
      from unnest(p_resource_ids) as requested(resource_id)
      where not exists (
        select 1
        from generate_series(1, v_room.capacity) as seat(number)
        where requested.resource_id =
          chr(65 + ((seat.number - 1) / 6)) || (((seat.number - 1) % 6) + 1)::text
      )
    ) then
      raise exception 'INVALID_SEAT' using errcode = '22023';
    end if;
  end if;

  v_starts_at := (p_booking_date + p_start_time) at time zone 'Asia/Ho_Chi_Minh';
  v_ends_at := v_starts_at + make_interval(hours => p_duration_hours);
  if v_starts_at <= now() then
    raise exception 'START_TIME_IN_PAST' using errcode = '22023';
  end if;
  v_total_amount := v_room.hourly_rate * p_duration_hours *
    case when v_room.booking_mode = 'whole-room' then 1 else v_resource_count end;

  update public.booking_resources
  set status = 'expired'
  where status = 'held' and hold_expires_at <= now();

  update public.bookings b
  set status = 'expired'
  where b.status = 'awaiting_payment'
    and not exists (
      select 1 from public.booking_resources r
      where r.booking_id = b.id and r.status = 'held'
    );

  if p_replace_booking_id is not null then
    update public.bookings
    set status = 'cancelled'
    where id = p_replace_booking_id and user_id = v_user_id
      and status = 'awaiting_payment'
      and exists (
        select 1 from public.booking_resources r
        where r.booking_id = p_replace_booking_id
          and r.status = 'held' and r.hold_expires_at > now()
      );
    if not found then
      raise exception 'PREVIOUS_HOLD_INVALID' using errcode = 'P0002';
    end if;
    update public.booking_resources
    set status = 'cancelled'
    where booking_id = p_replace_booking_id and status = 'held';
  end if;

  insert into public.bookings (
    user_id, room_id, booking_date, starts_at, ends_at, duration_hours, total_amount, status
  ) values (
    v_user_id, p_room_id, p_booking_date, v_starts_at, v_ends_at,
    p_duration_hours, v_total_amount, 'awaiting_payment'
  ) returning id, payment_reference into v_booking_id, v_payment_reference;

  insert into public.booking_resources (
    booking_id, room_id, booking_date, resource_id, starts_at, ends_at, status, hold_expires_at
  )
  select
    v_booking_id, p_room_id, p_booking_date, requested.resource_id,
    v_starts_at, v_ends_at, 'held', v_hold_expires_at
  from unnest(p_resource_ids) as requested(resource_id);

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'payment_reference', v_payment_reference,
    'total_amount', v_total_amount,
    'hold_expires_at', v_hold_expires_at
  );
exception
  when exclusion_violation then
    raise exception 'RESOURCE_UNAVAILABLE' using errcode = '23P01';
end;
$$;

create or replace function public.get_room_availability(
  p_room_id text,
  p_booking_date date
)
returns table (
  resource_id text,
  booking_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  hold_expires_at timestamptz,
  is_mine boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_day_start timestamptz := (p_booking_date::timestamp at time zone 'Asia/Ho_Chi_Minh');
  v_day_end timestamptz := ((p_booking_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  update public.booking_resources r
  set status = 'expired'
  where r.room_id = p_room_id and r.booking_date = p_booking_date
    and r.status = 'held' and r.hold_expires_at <= now();

  update public.bookings b
  set status = 'expired'
  where b.room_id = p_room_id and b.booking_date = p_booking_date
    and b.status = 'awaiting_payment'
    and not exists (
      select 1 from public.booking_resources r
      where r.booking_id = b.id and r.status = 'held'
    );

  return query
  select r.resource_id, r.booking_date, r.starts_at, r.ends_at, r.status, r.hold_expires_at,
    b.user_id = auth.uid()
  from public.booking_resources r
  join public.bookings b on b.id = r.booking_id
  where r.room_id = p_room_id and r.booking_date = p_booking_date
    and r.status in ('held', 'awaiting_verification', 'confirmed')
    and r.starts_at < v_day_end and r.ends_at > v_day_start;
end;
$$;

create or replace function public.submit_booking_transfer(
  p_booking_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if length(trim(coalesce(p_customer_name, ''))) < 2
    or position('@' in coalesce(p_customer_email, '')) < 2
    or length(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g')) < 8 then
    raise exception 'INVALID_CUSTOMER_DETAILS' using errcode = '22023';
  end if;

  update public.bookings b
  set status = 'awaiting_verification',
      customer_name = trim(p_customer_name),
      customer_email = lower(trim(p_customer_email)),
      customer_phone = trim(p_customer_phone)
  where b.id = p_booking_id and b.user_id = auth.uid()
    and b.status = 'awaiting_payment'
    and exists (
      select 1 from public.booking_resources r
      where r.booking_id = b.id and r.status = 'held' and r.hold_expires_at > now()
    )
  returning * into v_booking;

  if not found then
    raise exception 'BOOKING_EXPIRED_OR_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.booking_resources
  set status = 'awaiting_verification', hold_expires_at = null
  where booking_id = p_booking_id and status = 'held';

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'payment_reference', v_booking.payment_reference,
    'status', v_booking.status
  );
end;
$$;

create or replace function public.cancel_booking_hold(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id and user_id = auth.uid() and status = 'awaiting_payment';
  if not found then
    return false;
  end if;

  update public.booking_resources
  set status = 'cancelled'
  where booking_id = p_booking_id and status = 'held';
  return true;
end;
$$;

revoke all on function public.hold_booking_resources(text, date, time without time zone, integer, text[], uuid) from public, anon;
revoke all on function public.get_room_availability(text, date) from public, anon;
revoke all on function public.submit_booking_transfer(uuid, text, text, text) from public, anon;
revoke all on function public.cancel_booking_hold(uuid) from public, anon;
grant execute on function public.hold_booking_resources(text, date, time without time zone, integer, text[], uuid) to authenticated;
grant execute on function public.get_room_availability(text, date) to authenticated;
grant execute on function public.submit_booking_transfer(uuid, text, text, text) to authenticated;
grant execute on function public.cancel_booking_hold(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_resources'
  ) then
    alter publication supabase_realtime add table public.booking_resources;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end;
$$;
