-- Thali: what you ate (DESIGN.md 8.6g). One row per meal per day, and a daily water count. Additive only; accounts
-- only and owner only, like the health diary.

-- Every item in a list is 1 to max_len characters (an empty list passes).
create function public.short_items(items text[], max_len integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(item) between 1 and max_len), true) from unnest(items) as item
$$;

-- ---------------------------------------------------------------------------
-- food_log: a meal on a day (the day is the person's own local date, sent by the app)
-- ---------------------------------------------------------------------------
create table public.food_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day date not null check (day >= date '2020-01-01' and day <= current_date + 1),
  meal text not null check (meal in ('breakfast', 'lunch', 'snacks', 'dinner')),
  items text[] not null default '{}' check (cardinality(items) <= 15 and public.short_items(items, 60)),
  portion text check (portion in ('light', 'regular', 'heavy')),
  outside boolean not null default false,
  note text check (char_length(note) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day, meal),
  -- A meal says what was eaten: at least one item or a note.
  check (cardinality(items) > 0 or note is not null)
);
create index food_log_user_day on public.food_log (user_id, day desc);

-- At most 3000 meals per person: years of daily meals, and a cap on misuse.
create function public.food_log_cap() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.food_log where user_id = new.user_id) >= 3000 then
    raise exception 'too many meals' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.food_log_cap() from public, anon, authenticated;
create trigger food_log_cap before insert on public.food_log
  for each row execute function public.food_log_cap();

alter table public.food_log enable row level security;
create policy food_log_own on public.food_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy food_log_permanent_only on public.food_log
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.food_log from anon, authenticated;
grant select, insert, update, delete on public.food_log to authenticated;

-- ---------------------------------------------------------------------------
-- water_log: glasses of water on a day
-- ---------------------------------------------------------------------------
create table public.water_log (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day date not null check (day >= date '2020-01-01' and day <= current_date + 1),
  glasses smallint not null check (glasses between 0 and 30),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.water_log enable row level security;
create policy water_log_own on public.water_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy water_log_permanent_only on public.water_log
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.water_log from anon, authenticated;
grant select, insert, update, delete on public.water_log to authenticated;
