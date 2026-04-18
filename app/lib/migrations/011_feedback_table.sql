-- ═══════════════════════════════════════════════════════════════════
-- Migration 011: Feedback table — юзеры шлют фидбек из app
-- ═══════════════════════════════════════════════════════════════════
--
-- Настройки → "Отправить фидбек" → экран с textarea + категория
-- → INSERT в эту таблицу. Violetta читает через SQL или admin dashboard.
--
-- Альтернатива — email через SendGrid Edge Function, но для MVP
-- достаточно SQL-таблицы + manual SELECT каждое утро.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists feedback (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete set null,
  category text not null check (category in ('bug', 'idea', 'praise', 'other')),
  message text not null,
  contact_email text,
  app_version text,
  platform text check (platform in ('ios', 'android', 'web')),
  locale text,
  device_info jsonb default '{}',
  resolved boolean default false,
  created_at timestamptz default now()
);

create index if not exists feedback_unresolved_idx on feedback (resolved, created_at desc) where not resolved;

alter table feedback enable row level security;

-- Authenticated users могут писать свой feedback (или anon — гость без логина)
create policy "Anyone authenticated can insert feedback"
  on feedback for insert
  to authenticated, anon
  with check (true);

-- Users могут читать только свой feedback (для UI "мои обращения")
create policy "Users can read own feedback"
  on feedback for select
  using (auth.uid() = user_id);

-- Admin (service_role) читает и помечает resolved через Supabase Dashboard

-- ═══════════════════════════════════════════════════════════════════
-- Daily query для Violetta:
-- select category, count(*), array_agg(message) from feedback
-- where created_at > now() - interval '24 hours' and not resolved
-- group by category;
-- ═══════════════════════════════════════════════════════════════════

-- ROLLBACK
-- drop table if exists feedback;
