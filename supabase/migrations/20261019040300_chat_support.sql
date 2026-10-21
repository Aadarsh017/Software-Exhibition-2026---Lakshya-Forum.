-- Support for the chat function.
--   1. An answer points at the question it answers (messages.reply_to), one answer per question.
--      That makes a retried request safe: the second insert is refused instead of duplicating.
--   2. A server-only total of today's usage, for the daily spending cap.

alter table public.messages
  add column reply_to uuid references public.messages (id) on delete cascade;

create unique index messages_one_answer_per_question
  on public.messages (reply_to) where reply_to is not null;

create function public.usage_totals_today(p_timezone text default 'Asia/Kolkata')
returns table (messages bigint, tokens_in bigint, tokens_out bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.messages), 0)::bigint,
         coalesce(sum(u.tokens_in), 0)::bigint,
         coalesce(sum(u.tokens_out), 0)::bigint
  from public.usage_daily u
  where u.day = (now() at time zone p_timezone)::date
$$;

revoke all on function public.usage_totals_today(text) from public, anon, authenticated;
grant execute on function public.usage_totals_today(text) to service_role;
