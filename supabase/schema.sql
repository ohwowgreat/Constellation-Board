-- ════════════════════════════════════════════════
-- CONSTELLATION BOARD — SHARED WORKSPACE SCHEMA
-- ════════════════════════════════════════════════
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- It is safe to re-run: every statement is idempotent.
--
-- IMPORTANT: this sets up a single workspace with NO login. Anyone who can
-- reach the page can read, edit and delete every board. That is the intended
-- model here; see README.md if you need something tighter.

-- ── BOARDS TABLE ────────────────────────────────
create table if not exists public.boards (
  id          text primary key,
  name        text        not null default 'Board',
  bg          text        not null default '#141414',
  scroll_x    integer     not null default 0,
  scroll_y    integer     not null default 0,
  sort_order  integer     not null default 0,
  items       jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists boards_sort_order_idx on public.boards (sort_order);

-- Stamp updated_at on every write so "last edited" is meaningful.
create or replace function public.boards_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists boards_touch_updated_at on public.boards;
create trigger boards_touch_updated_at
  before insert or update on public.boards
  for each row execute function public.boards_touch_updated_at();

-- ── ROW LEVEL SECURITY ──────────────────────────
-- RLS stays on, but the policies are deliberately open: the workspace is
-- shared by everyone holding the page URL and the anon key.
alter table public.boards enable row level security;

drop policy if exists "boards are readable by anyone"  on public.boards;
drop policy if exists "boards are insertable by anyone" on public.boards;
drop policy if exists "boards are updatable by anyone"  on public.boards;
drop policy if exists "boards are deletable by anyone"  on public.boards;

create policy "boards are readable by anyone"
  on public.boards for select to anon, authenticated using (true);

create policy "boards are insertable by anyone"
  on public.boards for insert to anon, authenticated with check (true);

create policy "boards are updatable by anyone"
  on public.boards for update to anon, authenticated using (true) with check (true);

create policy "boards are deletable by anyone"
  on public.boards for delete to anon, authenticated using (true);

-- ── IMAGE STORAGE ───────────────────────────────
-- Images used to be inlined into each board as base64 data URLs, which blew
-- through the 5 MB localStorage cap fast. They now live here instead and the
-- board only stores a URL.
insert into storage.buckets (id, name, public)
values ('board-images', 'board-images', true)
on conflict (id) do update set public = true;

drop policy if exists "board images are readable by anyone"    on storage.objects;
drop policy if exists "board images are uploadable by anyone"  on storage.objects;

create policy "board images are readable by anyone"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'board-images');

create policy "board images are uploadable by anyone"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'board-images');
