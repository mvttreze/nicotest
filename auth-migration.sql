-- Run this in Supabase SQL Editor before enabling signed-in conversations.
-- Existing conversations are assigned to Matt's account after sign-in.

alter table public.conversations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Replace this with Matt's Supabase auth user id after his first Google sign-in.
-- update public.conversations
-- set user_id = 'YOUR-SUPABASE-USER-UUID'
-- where user_id is null;

create index if not exists conversations_user_id_idx
  on public.conversations(user_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations"
  on public.conversations for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their conversations" on public.conversations;
create policy "Users can create their conversations"
  on public.conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their conversations" on public.conversations;
create policy "Users can update their conversations"
  on public.conversations for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their conversations" on public.conversations;
create policy "Users can delete their conversations"
  on public.conversations for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can view messages in their conversations" on public.messages;
create policy "Users can view messages in their conversations"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

drop policy if exists "Users can create messages in their conversations" on public.messages;
create policy "Users can create messages in their conversations"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete messages in their conversations" on public.messages;
create policy "Users can delete messages in their conversations"
  on public.messages for delete
  using (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

-- Persist image/file attachments on messages so old conversations reload
-- their pictures on any device (run once in Supabase SQL Editor, then
-- redeploy the backend).
alter table public.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Jarvis pack: long-term memory per user.
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists memories_user_id_idx
  on public.memories(user_id);

alter table public.memories enable row level security;

drop policy if exists "Users manage their memories" on public.memories;
create policy "Users manage their memories"
  on public.memories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Badges: admin-distributed roles (tester / major_supporter / supporter).
-- Admins are implicit and need no row.
create table if not exists public.user_badges (
  user_id uuid references auth.users(id) on delete cascade,
  badge text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, badge)
);

create index if not exists user_badges_user_id_idx
  on public.user_badges(user_id);

alter table public.user_badges enable row level security;

drop policy if exists "Users read their badges" on public.user_badges;
create policy "Users read their badges"
  on public.user_badges for select
  using (auth.uid() = user_id);
