create table public.user_favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  room_id text not null references public.booking_rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

create index user_favorites_room_id_idx on public.user_favorites (room_id);

alter table public.user_favorites enable row level security;

create policy "Users can read their own favorite rooms"
  on public.user_favorites for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can add their own favorite rooms"
  on public.user_favorites for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can remove their own favorite rooms"
  on public.user_favorites for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.user_favorites to authenticated;
revoke all on public.user_favorites from anon;