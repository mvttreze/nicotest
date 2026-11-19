-- Run once in the Supabase SQL editor before using Developer Dashboard > Patches
-- on the deployed service. The backend uses the service role after checking
-- admin authorization; browser clients receive no direct table access.

create table if not exists public.developer_patches (
  id text primary key,
  created_at timestamptz not null,
  record jsonb not null
);

create index if not exists developer_patches_created_at_idx
  on public.developer_patches (created_at desc);

alter table public.developer_patches enable row level security;
revoke all on table public.developer_patches from anon, authenticated;
grant all on table public.developer_patches to service_role;
