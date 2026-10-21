-- Continuity of care (DESIGN.md 8.6c, PLAN.md §12): a health diary, and an emergency card.
-- Additive only. Like the rest of the health data, both are for accounts only.

-- ---------------------------------------------------------------------------
-- health_log: the person's own diary (how they feel, a symptom, how bad, temperature, a note)
-- ---------------------------------------------------------------------------
create table public.health_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  logged_at timestamptz not null default now() check (logged_at <= now() + interval '1 day'),
  symptom text check (char_length(symptom) between 1 and 60),
  severity smallint check (severity between 0 and 10),
  temperature_c numeric(3, 1) check (temperature_c between 34 and 43),
  feeling text check (feeling in ('better', 'same', 'worse')),
  note text check (char_length(note) between 1 and 280),
  -- The chat a check-in came from. Kept as a pointer only; the entry stays if the chat is deleted.
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  -- An entry says something.
  check (symptom is not null or severity is not null or temperature_c is not null or feeling is not null or note is not null)
);
create index health_log_user_time on public.health_log (user_id, logged_at desc);

-- At most 1000 entries per person: years of daily entries, and a cap on misuse.
create function public.health_log_cap() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.health_log where user_id = new.user_id) >= 1000 then
    raise exception 'too many diary entries' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.health_log_cap() from public, anon, authenticated;
create trigger health_log_cap before insert on public.health_log
  for each row execute function public.health_log_cap();

alter table public.health_log enable row level security;
create policy health_log_own on public.health_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (conversation_id is null or exists (
      select 1 from public.conversations c where c.id = conversation_id and c.user_id = (select auth.uid())))
  );
create policy health_log_permanent_only on public.health_log
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.health_log from anon, authenticated;
grant select, insert, update, delete on public.health_log to authenticated;

-- ---------------------------------------------------------------------------
-- health_profile: the emergency card. The contact is for the person's own screen only: the server never reads it.
-- ---------------------------------------------------------------------------
alter table public.health_profile
  add column blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown')),
  add column emergency_contact_name text check (char_length(emergency_contact_name) between 1 and 60),
  add column emergency_contact_phone text check (emergency_contact_phone ~ '^\+?[0-9][0-9 ()-]{5,19}$');
