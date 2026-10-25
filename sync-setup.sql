-- Run once in Supabase: SQL Editor > New query > paste > Run.
create table if not exists public.docs (
  user_id    uuid    not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text    not null,                 -- verse | progress | lie | kv
  id         text    not null,
  data       jsonb   not null default '{}'::jsonb,
  updated_at bigint  not null,                 -- device timestamp (ms): decides last-write-wins
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now(), -- server time: used to fetch "what changed since I last looked"
  primary key (user_id, kind, id)
);
create index if not exists docs_user_synced on public.docs (user_id, synced_at);

create or replace function public.touch_synced_at() returns trigger language plpgsql as $$
begin new.synced_at = now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.touch_synced_at();

alter table public.docs enable row level security;
drop policy if exists "own rows" on public.docs;
create policy "own rows" on public.docs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
