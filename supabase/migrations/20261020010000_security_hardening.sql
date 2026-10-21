-- Security review (2026-10-20, PLAN.md §12 "Security review"). Additive hardening; nothing the app does is taken away.

-- ---------------------------------------------------------------------------
-- 1. People can't delete single messages (it let a saved answer be removed and the question re-asked free, over and
--    over). The app never did this: deleting a chat still removes its messages through the conversation's cascade.
-- ---------------------------------------------------------------------------
drop policy messages_delete_own on public.messages;
revoke delete on public.messages from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sizes. Profile list items go into every AI prompt, so each is short; a summary is at most 64 KB; a consent row
--    names a short version. NOT VALID: new and changed rows are checked, old rows are left alone.
-- ---------------------------------------------------------------------------
alter table public.health_profile add constraint health_profile_items_short check (
  public.short_items(conditions, 80) and public.short_items(allergies, 80)
  and public.short_items(medicines, 80) and public.short_items(family_history, 80)
) not valid;

alter table public.summaries add constraint summaries_content_size check (octet_length(content::text) <= 65536) not valid;
alter table public.consents add constraint consents_version_short check (version ~ '^[A-Za-z0-9._-]{1,20}$') not valid;

-- ---------------------------------------------------------------------------
-- 3. Per-person caps run AFTER the row-level checks (so they never run on someone else's id, and never reveal how many
--    rows another person has), and take a per-person lock (so parallel inserts can't race past them).
-- ---------------------------------------------------------------------------
create or replace function public.lab_results_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:lab_results:' || new.user_id::text));
  if (select count(*) from public.lab_results where user_id = new.user_id) > 300 then
    raise exception 'too many lab results' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
drop trigger lab_results_cap on public.lab_results;
create trigger lab_results_cap after insert on public.lab_results for each row execute function public.lab_results_cap();

create or replace function public.health_log_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:health_log:' || new.user_id::text));
  if (select count(*) from public.health_log where user_id = new.user_id) > 1000 then
    raise exception 'too many diary entries' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
drop trigger health_log_cap on public.health_log;
create trigger health_log_cap after insert on public.health_log for each row execute function public.health_log_cap();

create or replace function public.medicine_schedule_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:medicine_schedule:' || new.user_id::text));
  if (select count(*) from public.medicine_schedule where user_id = new.user_id) > 50 then
    raise exception 'too many medicines' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
drop trigger medicine_schedule_cap on public.medicine_schedule;
create trigger medicine_schedule_cap after insert on public.medicine_schedule for each row execute function public.medicine_schedule_cap();

-- Ticks older than about 13 months are pruned for the person who just ticked (after the row-level checks now).
create or replace function public.dose_log_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:dose_log:' || new.user_id::text));
  delete from public.dose_log where user_id = new.user_id and taken_on < current_date - 400;
  if (select count(*) from public.dose_log where user_id = new.user_id) > 20000 then
    raise exception 'too many medicine ticks' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
drop trigger dose_log_cap on public.dose_log;
create trigger dose_log_cap after insert on public.dose_log for each row execute function public.dose_log_cap();

create or replace function public.food_log_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:food_log:' || new.user_id::text));
  if (select count(*) from public.food_log where user_id = new.user_id) > 3000 then
    raise exception 'too many meals' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
drop trigger food_log_cap on public.food_log;
create trigger food_log_cap after insert on public.food_log for each row execute function public.food_log_cap();

-- New: summaries (200 per person) and consent rows (50 per person), which had no cap.
create function public.summaries_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:summaries:' || new.user_id::text));
  if (select count(*) from public.summaries where user_id = new.user_id) > 200 then
    raise exception 'too many summaries' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
create trigger summaries_cap after insert on public.summaries for each row execute function public.summaries_cap();

create function public.consents_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:consents:' || new.user_id::text));
  if (select count(*) from public.consents where user_id = new.user_id) > 50 then
    raise exception 'too many consents' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
create trigger consents_cap after insert on public.consents for each row execute function public.consents_cap();

revoke all on function public.lab_results_cap(), public.health_log_cap(), public.medicine_schedule_cap(), public.dose_log_cap(),
  public.food_log_cap(), public.summaries_cap(), public.consents_cap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Functions: nobody can call a new function unless it is granted on purpose. The earlier per-schema line could not
--    remove the built-in grant to everyone; this one does, for every function created from now on. The trigger
--    functions that were created before lose it too (triggers still fire: that needs no execute grant).
-- ---------------------------------------------------------------------------
alter default privileges revoke execute on functions from public;
revoke execute on function public.set_updated_at(), public.handle_new_user(), public.touch_conversation(),
  public.medicine_schedule_stamps(), public.dose_log_pills() from public;
