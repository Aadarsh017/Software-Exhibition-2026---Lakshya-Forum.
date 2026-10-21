-- Server-side helpers: daily quota, usage counters and clean-up jobs.
-- All are callable by the service role only (the Edge Functions and scheduled jobs).

-- Atomically counts one message for today (Indian time) and says whether it is within the limit.
create function public.consume_quota(p_user uuid, p_limit integer, p_timezone text default 'Asia/Kolkata')
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
  return query select (v_used <= p_limit), v_used, greatest(p_limit - v_used, 0);
end
$$;

-- Adds token counts to today's row once the answer is done.
create function public.add_usage_tokens(p_user uuid, p_tokens_in bigint, p_tokens_out bigint,
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
end
$$;

-- Supabase does not clean up anonymous users. Deleting the auth user cascades to all their data.
create function public.purge_stale_guests(p_days integer default 30) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with gone as (
    delete from auth.users u
    where u.is_anonymous
      and coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end
$$;

create function public.purge_expired_cache() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with gone as (delete from public.source_cache where expires_at < now() returning 1)
  select count(*) into v_count from gone;
  return v_count;
end
$$;

create function public.purge_old_rule_events(p_days integer default 90) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.rule_events where created_at < now() - make_interval(days => p_days) returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end
$$;

revoke all on function public.consume_quota(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.add_usage_tokens(uuid, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.purge_stale_guests(integer) from public, anon, authenticated;
revoke all on function public.purge_expired_cache() from public, anon, authenticated;
revoke all on function public.purge_old_rule_events(integer) from public, anon, authenticated;
grant execute on function public.consume_quota(uuid, integer, text) to service_role;
grant execute on function public.add_usage_tokens(uuid, bigint, bigint, text) to service_role;
grant execute on function public.purge_stale_guests(integer) to service_role;
grant execute on function public.purge_expired_cache() to service_role;
grant execute on function public.purge_old_rule_events(integer) to service_role;
