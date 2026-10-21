-- Bug review (2026-10-20, PLAN.md §12 "Bug review"), batch 2: money and stray rows. Additive; nothing the app does
-- is taken away.

-- ---------------------------------------------------------------------------
-- 1. Today's AI use for everyone, kept apart from each person's own row. The daily token cap read the sum of
--    usage_daily, whose rows go with the account: deleting an account (or a guest deleting itself after using its
--    questions) lowered today's total, so the cap could be dodged. Per-person rows still go with the account.
-- ---------------------------------------------------------------------------
create table public.usage_global_daily (
  day date primary key,
  messages bigint not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0
);
alter table public.usage_global_daily enable row level security;
revoke all on public.usage_global_daily from public, anon, authenticated;

insert into public.usage_global_daily (day, messages, tokens_in, tokens_out)
  select day, sum(messages), sum(tokens_in), sum(tokens_out) from public.usage_daily group by day;

create or replace function public.consume_quota(p_user uuid, p_limit integer, p_timezone text default 'Asia/Kolkata')
returns table (allowed boolean, used integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone p_timezone)::date;
  v_used integer;
begin
  if p_limit < 0 then
    raise exception 'limit must not be negative';
  end if;
  insert into public.usage_daily as u (user_id, day, messages)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update set messages = u.messages + 1
  returning u.messages into v_used;
  insert into public.usage_global_daily as g (day, messages)
  values (v_day, 1)
  on conflict (day) do update set messages = g.messages + 1;
  return query select (v_used <= p_limit), v_used, greatest(p_limit - v_used, 0);
end
$$;

create or replace function public.add_usage_tokens(p_user uuid, p_tokens_in bigint, p_tokens_out bigint,
                                                   p_timezone text default 'Asia/Kolkata')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone p_timezone)::date;
begin
  insert into public.usage_daily as u (user_id, day, messages, tokens_in, tokens_out)
  values (p_user, v_day, 0, greatest(p_tokens_in, 0), greatest(p_tokens_out, 0))
  on conflict (user_id, day) do update
    set tokens_in = u.tokens_in + greatest(p_tokens_in, 0),
        tokens_out = u.tokens_out + greatest(p_tokens_out, 0);
  insert into public.usage_global_daily as g (day, tokens_in, tokens_out)
  values (v_day, greatest(p_tokens_in, 0), greatest(p_tokens_out, 0))
  on conflict (day) do update
    set tokens_in = g.tokens_in + greatest(p_tokens_in, 0),
        tokens_out = g.tokens_out + greatest(p_tokens_out, 0);
end
$$;

create or replace function public.usage_totals_today(p_timezone text default 'Asia/Kolkata')
returns table (messages bigint, tokens_in bigint, tokens_out bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(g.messages), 0)::bigint, coalesce(max(g.tokens_in), 0)::bigint, coalesce(max(g.tokens_out), 0)::bigint
  from public.usage_global_daily g
  where g.day = (now() at time zone p_timezone)::date
$$;

-- ---------------------------------------------------------------------------
-- 2. A question counted by a request that then turned out to be a parallel duplicate (it never ran) is given back.
-- ---------------------------------------------------------------------------
create function public.release_quota(p_user uuid, p_timezone text default 'Asia/Kolkata')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone p_timezone)::date;
begin
  update public.usage_daily set messages = greatest(messages - 1, 0) where user_id = p_user and day = v_day;
  update public.usage_global_daily set messages = greatest(messages - 1, 0) where day = v_day;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. A first question refused for the daily limit leaves no empty chat behind. Only a chat with no messages at all.
-- ---------------------------------------------------------------------------
create function public.delete_empty_conversation(p_user uuid, p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.conversations c
  where c.id = p_conversation and c.user_id = p_user
    and not exists (select 1 from public.messages m where m.conversation_id = c.id)
$$;

revoke all on function public.release_quota(uuid, text), public.delete_empty_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_quota(uuid, text), public.delete_empty_conversation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. At most 5000 chats per person (years of daily use), like the other per-person caps: after the row checks, with
--    a per-person lock.
-- ---------------------------------------------------------------------------
create function public.conversations_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cap:conversations:' || new.user_id::text));
  if (select count(*) from public.conversations where user_id = new.user_id) > 5000 then
    raise exception 'too many chats' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke all on function public.conversations_cap() from public, anon, authenticated;
create trigger conversations_cap after insert on public.conversations for each row execute function public.conversations_cap();
