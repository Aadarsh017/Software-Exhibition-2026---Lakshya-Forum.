-- Bug review (2026-10-20, PLAN.md §12 "Bug review"), batch 3: information shown wrong. Additive.

-- ---------------------------------------------------------------------------
-- 1. Renaming a chat no longer makes it look recent. updated_at means "when this consultation last happened": Recents
--    sorts by it, the home check-in picks chats 8 hours to 4 days old by it, and Nox's memory of earlier chats dates
--    them by it. A new message sets it on purpose; a title-only change (a rename, or the server naming a new chat)
--    leaves it; anything else stamps now.
-- ---------------------------------------------------------------------------
create or replace function public.touch_conversation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  levels constant text[] := array['selfcare', 'doctor', 'doctor24', 'emergency', 'ambulance'];
begin
  update public.conversations c
     set max_care_level = case
           when new.care_level is null then c.max_care_level
           when c.max_care_level is null then new.care_level
           when array_position(levels, new.care_level) > array_position(levels, c.max_care_level) then new.care_level
           else c.max_care_level
         end,
         updated_at = now()
   where c.id = new.conversation_id;
  return new;
end
$$;

create function public.conversations_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  probe public.conversations;
begin
  if new.updated_at is distinct from old.updated_at then
    return new; -- set on purpose (a new message)
  end if;
  probe := new;
  probe.title := old.title;
  if probe is not distinct from old then
    return new; -- only the title changed: the chat keeps its time
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function public.conversations_stamp() from public;

drop trigger conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.conversations_stamp();

-- ---------------------------------------------------------------------------
-- 2. Undoing a tick gives back a pill only if that tick took one. A tick at 0 pills takes nothing (the count can't go
--    below 0), so its undo used to add a pill the person never had. Ticks made before this change keep the old
--    behaviour (they are marked as having taken one).
-- ---------------------------------------------------------------------------
alter table public.dose_log add column took_pill boolean not null default true;
alter table public.dose_log alter column took_pill set default false;

create function public.dose_log_took_pill() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.took_pill := exists (select 1 from public.medicine_schedule s where s.id = new.schedule_id and s.pills_left > 0);
  return new;
end;
$$;
revoke execute on function public.dose_log_took_pill() from public;
create trigger dose_log_took_pill before insert on public.dose_log
  for each row execute function public.dose_log_took_pill();

create or replace function public.dose_log_pills() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.took_pill then
      update public.medicine_schedule set pills_left = greatest(pills_left - 1, 0)
        where id = new.schedule_id and pills_left is not null;
    end if;
    return new;
  end if;
  if pg_trigger_depth() = 1 and old.took_pill then
    update public.medicine_schedule set pills_left = least(pills_left + 1, 2000)
      where id = old.schedule_id and pills_left is not null and pills_counted_at <= old.created_at;
  end if;
  return old;
end;
$$;
