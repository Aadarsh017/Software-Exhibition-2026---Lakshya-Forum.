-- Personal doctor v1 (DESIGN.md 8.6b, PLAN.md §12): more of what a personal doctor needs to know, and blood results.
-- Additive only: no existing column changes meaning. Health details and blood results stay accounts-only.

-- ---------------------------------------------------------------------------
-- health_profile: body, lifestyle and family history (all optional)
-- ---------------------------------------------------------------------------
alter table public.health_profile
  add column height_cm numeric(4, 1) check (height_cm between 40 and 250),
  add column weight_kg numeric(4, 1) check (weight_kg between 2 and 350),
  add column smoking text check (smoking in ('never', 'former', 'current')),
  add column alcohol text check (alcohol in ('none', 'occasional', 'regular')),
  add column activity text check (activity in ('low', 'moderate', 'high')),
  add column family_history text[] not null default '{}' check (cardinality(family_history) <= 20);

-- ---------------------------------------------------------------------------
-- lab_results: values the person typed from a blood report, one row per marker per report date.
-- Marker keys come from packages/shared/src/labs.js; "other" rows carry their own name.
-- ---------------------------------------------------------------------------
create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  test_date date not null default current_date check (test_date between date '1990-01-01' and current_date + 1),
  marker text not null check (marker ~ '^[a-z0-9_]{1,40}$'),
  label text check (char_length(label) between 1 and 60),
  value numeric(12, 3) not null check (value >= 0 and value < 1000000),
  unit text not null check (char_length(unit) between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "other" needs a name; known markers do not.
  check (marker <> 'other' or label is not null)
);
create index lab_results_user_date on public.lab_results (user_id, test_date desc);
create trigger lab_results_updated_at before update on public.lab_results
  for each row execute function public.set_updated_at();

-- At most 300 values per person: plenty for years of reports, and a cap on misuse.
create function public.lab_results_cap() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.lab_results where user_id = new.user_id) >= 300 then
    raise exception 'too many lab results' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.lab_results_cap() from public, anon, authenticated;
create trigger lab_results_cap before insert on public.lab_results
  for each row execute function public.lab_results_cap();

alter table public.lab_results enable row level security;
create policy lab_results_own on public.lab_results
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Restrictive, so it is ANDed with the policy above: guests are shut out, exactly like health_profile.
create policy lab_results_permanent_only on public.lab_results
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.lab_results from anon, authenticated;
grant select, insert, update, delete on public.lab_results to authenticated;
