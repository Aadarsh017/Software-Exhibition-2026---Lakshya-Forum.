-- Health Chat Helper: core schema, row-level security and grants.
-- Design: PLAN.md section 7. Principles:
--   1. Every table in public has RLS on.
--   2. Browser roles get the minimum: no default grants, explicit column privileges.
--   3. Guests are ordinary `authenticated` users with an `is_anonymous` claim in their JWT.
--   4. Assistant messages, conversations and usage are written only by Edge Functions (service role).

-- ---------------------------------------------------------------------------
-- Default-deny: tables, sequences and functions created later are NOT reachable
-- by browser roles unless granted explicitly.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user (guests included), created by a trigger.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  language text not null default 'en' check (language in ('en', 'hi')),
  theme text not null default 'auto' check (theme in ('auto', 'light', 'night')),
  text_size text not null default 'm' check (text_size in ('s', 'm', 'l', 'xl')),
  save_chats boolean not null default true,
  use_profile_in_answers boolean not null default true,
  voice_enabled boolean not null default false,   -- voice typing is opt-in: audio may leave the device
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, language, theme, text_size, save_chats, use_profile_in_answers,
              voice_enabled, onboarded_at) on public.profiles to authenticated;

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- health_profile: optional, sensitive, permanent (non-guest) users only.
-- ---------------------------------------------------------------------------
create table public.health_profile (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  age_range text check (age_range in ('18-24', '25-34', '35-44', '45-54', '55-64', '65-74', '75+')),
  sex_at_birth text check (sex_at_birth in ('female', 'male', 'intersex', 'prefer_not_to_say')),
  pregnancy text check (pregnancy in ('yes', 'no', 'not_sure', 'not_applicable')),
  conditions text[] not null default '{}' check (cardinality(conditions) <= 30),
  allergies text[] not null default '{}' check (cardinality(allergies) <= 30),
  medicines text[] not null default '{}' check (cardinality(medicines) <= 50),
  updated_at timestamptz not null default now()
);
create trigger health_profile_set_updated_at before update on public.health_profile
  for each row execute function public.set_updated_at();

alter table public.health_profile enable row level security;
create policy health_profile_own on public.health_profile
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Restrictive policies are ANDed with the permissive one above: guests are shut out.
create policy health_profile_permanent_only on public.health_profile
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.health_profile from anon, authenticated;
grant select, insert, update, delete on public.health_profile to authenticated;

-- ---------------------------------------------------------------------------
-- consents: append-only record of what the user accepted, with document versions.
-- ---------------------------------------------------------------------------
create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  doc_type text not null check (doc_type in ('terms', 'privacy', 'ai_processing', 'age_18')),
  version text not null check (char_length(version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  unique (user_id, doc_type, version)
);

alter table public.consents enable row level security;
create policy consents_select_own on public.consents
  for select to authenticated using ((select auth.uid()) = user_id);
create policy consents_insert_own on public.consents
  for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on public.consents from anon, authenticated;
grant select on public.consents to authenticated;
grant insert (doc_type, version) on public.consents to authenticated;   -- user_id and time come from defaults

-- ---------------------------------------------------------------------------
-- conversations: created by the chat function; the browser may only rename or delete.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text check (char_length(title) <= 120),
  topic text,
  language text,
  max_care_level text check (max_care_level in ('selfcare', 'doctor', 'doctor24', 'emergency', 'ambulance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index conversations_user_updated_idx on public.conversations (user_id, updated_at desc);
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;
create policy conversations_select_own on public.conversations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy conversations_update_own on public.conversations
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy conversations_delete_own on public.conversations
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.conversations from anon, authenticated;
grant select, delete on public.conversations to authenticated;
grant update (title) on public.conversations to authenticated;

-- ---------------------------------------------------------------------------
-- messages: read and delete only from the browser, so nobody can forge "the AI said".
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text check (char_length(content) <= 20000),
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  sources jsonb check (sources is null or jsonb_typeof(sources) = 'array'),
  rule_ids text[] not null default '{}',                 -- ids only, never message text
  care_level text check (care_level in ('selfcare', 'doctor', 'doctor24', 'emergency', 'ambulance')),
  raised_by_rules boolean not null default false,
  content_version text,
  model text,
  tokens_in integer check (tokens_in >= 0),
  tokens_out integer check (tokens_out >= 0),
  latency_ms integer check (latency_ms >= 0),
  client_message_id uuid,                                -- idempotency key for retries
  created_at timestamptz not null default now(),
  -- A message always belongs to a conversation of the same user.
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade,
  foreign key (user_id) references public.profiles (id) on delete cascade,
  unique (conversation_id, client_message_id)
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_user_created_idx on public.messages (user_id, created_at desc);

alter table public.messages enable row level security;
create policy messages_select_own on public.messages
  for select to authenticated using ((select auth.uid()) = user_id);
create policy messages_delete_own on public.messages
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.messages from anon, authenticated;
grant select, delete on public.messages to authenticated;

-- The conversation's highest care level can only go up, and its timestamp follows its messages.
create function public.touch_conversation() returns trigger
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
         end
   where c.id = new.conversation_id;
  return new;
end
$$;
create trigger messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

-- ---------------------------------------------------------------------------
-- summaries: doctor summaries the user keeps. The user authors and edits them.
-- ---------------------------------------------------------------------------
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  title text check (char_length(title) <= 120),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index summaries_user_created_idx on public.summaries (user_id, created_at desc);
create trigger summaries_set_updated_at before update on public.summaries
  for each row execute function public.set_updated_at();

alter table public.summaries enable row level security;
create policy summaries_select_own on public.summaries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy summaries_insert_own on public.summaries
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (conversation_id is null or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())))
  );
create policy summaries_update_own on public.summaries
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy summaries_delete_own on public.summaries
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.summaries from anon, authenticated;
grant select, delete on public.summaries to authenticated;
grant insert (conversation_id, title, content) on public.summaries to authenticated;
grant update (title, content) on public.summaries to authenticated;

-- ---------------------------------------------------------------------------
-- feedback: a rating on an assistant answer, with an optional reason.
-- ---------------------------------------------------------------------------
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  reason text check (reason in ('wrong', 'unclear', 'too_scary', 'too_vague', 'other')),
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);

alter table public.feedback enable row level security;
create policy feedback_select_own on public.feedback
  for select to authenticated using ((select auth.uid()) = user_id);
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.messages m
                where m.id = message_id and m.user_id = (select auth.uid()) and m.role = 'assistant')
  );
create policy feedback_update_own on public.feedback
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy feedback_delete_own on public.feedback
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.feedback from anon, authenticated;
grant select, delete on public.feedback to authenticated;
grant insert (message_id, rating, reason) on public.feedback to authenticated;
grant update (rating, reason) on public.feedback to authenticated;

-- ---------------------------------------------------------------------------
-- feature_flags: read-only for signed-in users (guests included), written by the service role.
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  value jsonb not null,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
create policy feature_flags_read on public.feature_flags
  for select to authenticated using (true);
revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to authenticated;

insert into public.feature_flags (key, value, note) values
  ('care_level_display', 'true'::jsonb,
   'Shows the five-level care band. May count as triage under Indian device rules: get a legal opinion before public beta (PLAN.md R2).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Server-only tables: RLS on, no policies, no browser grants.
-- ---------------------------------------------------------------------------
create table public.source_cache (
  key text primary key,
  source text not null check (source in ('medlineplus', 'connect', 'clinical_tables', 'openfda', 'rxnorm', 'dailymed')),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index source_cache_expires_idx on public.source_cache (expires_at);

create table public.usage_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  messages integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  primary key (user_id, day)
);

create table public.rule_events (                       -- red-flag hits. Rule ids only, never message text.
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  rule_ids text[] not null,
  level text not null check (level in ('emergency', 'ambulance')),
  source text not null default 'rules' check (source in ('rules', 'model', 'client')),
  dismissed_as_not_emergency boolean not null default false,
  created_at timestamptz not null default now()
);
create index rule_events_created_idx on public.rule_events (created_at);

alter table public.source_cache enable row level security;
alter table public.usage_daily enable row level security;
alter table public.rule_events enable row level security;
revoke all on public.source_cache, public.usage_daily, public.rule_events from anon, authenticated;
