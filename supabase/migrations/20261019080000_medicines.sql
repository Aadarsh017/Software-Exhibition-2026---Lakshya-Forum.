-- Medicines today (DESIGN.md 8.6e, PLAN.md §12 "Research round 2"): when each regular medicine is taken, one tick per
-- dose, and an optional count of pills left. Additive only. Like the rest of the health data: accounts only, owner only.

-- ---------------------------------------------------------------------------
-- medicine_schedule: when each regular medicine is taken. The names stay a plain list in health_profile.medicines;
-- this adds the times of day for the ones that have them, one row per medicine (ignoring case).
-- ---------------------------------------------------------------------------
create table public.medicine_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  medicine text not null check (char_length(medicine) between 1 and 60),
  medicine_key text generated always as (lower(medicine)) stored,
  slots text[] not null check (cardinality(slots) between 1 and 4 and slots <@ array['morning', 'afternoon', 'evening', 'night']),
  pills_left smallint check (pills_left between 0 and 2000),
  -- Kept by the database: when the times last changed (the doctor summary counts from the day after), and when the
  -- person last typed a pill count (undoing an older tick doesn't put a pill back).
  times_set_at timestamptz not null default now(),
  pills_counted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, medicine_key)
);

create function public.medicine_schedule_stamps() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slots is distinct from old.slots then
    new.times_set_at := now();
  end if;
  -- A count the person typed. A tick counting a pill down arrives from the dose_log trigger, one level deeper.
  if new.pills_left is distinct from old.pills_left and pg_trigger_depth() = 1 then
    new.pills_counted_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.medicine_schedule_stamps() from public, anon, authenticated;
create trigger medicine_schedule_stamps before update on public.medicine_schedule
  for each row execute function public.medicine_schedule_stamps();

-- At most 50 medicines per person, the same as the profile's list.
create function public.medicine_schedule_cap() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.medicine_schedule where user_id = new.user_id) >= 50 then
    raise exception 'too many medicines' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.medicine_schedule_cap() from public, anon, authenticated;
create trigger medicine_schedule_cap before insert on public.medicine_schedule
  for each row execute function public.medicine_schedule_cap();

alter table public.medicine_schedule enable row level security;
create policy medicine_schedule_own on public.medicine_schedule
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy medicine_schedule_permanent_only on public.medicine_schedule
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.medicine_schedule from anon, authenticated;
grant select, delete on public.medicine_schedule to authenticated;
-- The stamps are the database's own, so the browser can't write them.
grant insert (user_id, medicine, slots, pills_left), update (user_id, medicine, slots, pills_left) on public.medicine_schedule to authenticated;

-- ---------------------------------------------------------------------------
-- dose_log: one tick per medicine, time of day and day. A tick is a record of what the person says they took, never
-- an instruction. The day is the person's medicine day (it changes at 5 AM in their own time zone).
-- ---------------------------------------------------------------------------
create table public.dose_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  schedule_id uuid not null references public.medicine_schedule (id) on delete cascade,
  slot text not null check (slot in ('morning', 'afternoon', 'evening', 'night')),
  taken_on date not null check (taken_on between date '2024-01-01' and current_date + 1),
  created_at timestamptz not null default now(),
  unique (schedule_id, slot, taken_on)
);
create index dose_log_user_day on public.dose_log (user_id, taken_on desc);

-- Ticks serve the home card and the summary's last two weeks, so about 13 months are kept; the oldest are cleared as
-- new ones come in. At most 20,000 per person (50 a day for 400 days): a cap on misuse.
create function public.dose_log_cap() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.dose_log where user_id = new.user_id and taken_on < current_date - 400;
  if (select count(*) from public.dose_log where user_id = new.user_id) >= 20000 then
    raise exception 'too many medicine ticks' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.dose_log_cap() from public, anon, authenticated;
create trigger dose_log_cap before insert on public.dose_log
  for each row execute function public.dose_log_cap();

-- Pills left: a tick counts one pill down; undoing it (the person's own delete) puts it back, unless the pills were
-- counted again since. Ticks cleared by the database or with their medicine leave the count alone.
create function public.dose_log_pills() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.medicine_schedule set pills_left = greatest(pills_left - 1, 0)
      where id = new.schedule_id and pills_left is not null;
    return new;
  end if;
  if pg_trigger_depth() = 1 then
    update public.medicine_schedule set pills_left = least(pills_left + 1, 2000)
      where id = old.schedule_id and pills_left is not null and pills_counted_at <= old.created_at;
  end if;
  return old;
end;
$$;
revoke all on function public.dose_log_pills() from public, anon, authenticated;
create trigger dose_log_pills after insert or delete on public.dose_log
  for each row execute function public.dose_log_pills();

alter table public.dose_log enable row level security;
create policy dose_log_own on public.dose_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.medicine_schedule s where s.id = schedule_id and s.user_id = (select auth.uid()))
  );
create policy dose_log_permanent_only on public.dose_log
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.dose_log from anon, authenticated;
-- Ticks are added and undone, never edited.
grant select, delete on public.dose_log to authenticated;
grant insert (user_id, schedule_id, slot, taken_on) on public.dose_log to authenticated;
