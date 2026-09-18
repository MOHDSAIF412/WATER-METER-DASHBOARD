-- OPERON water dashboard: who may sign in to the dashboard.
-- The accounts themselves live in auth.users, managed by Supabase.
-- This table only says which of them may use the dashboard, and as what.

create table public.wm_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null default '',
  role        text not null default 'viewer' check (role in ('admin','viewer')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz,
  updated_by  uuid
);
alter table public.wm_profiles enable row level security;

-- one row, written once, marking that the first administrator has been claimed
create table public.wm_meta (
  id  text primary key,
  at  timestamptz not null default now()
);
alter table public.wm_meta enable row level security;

-- security definer so the policies below do not recurse into wm_profiles
create or replace function public.wm_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wm_profiles p where p.id = auth.uid() and p.active);
$$;

create or replace function public.wm_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wm_profiles p where p.id = auth.uid() and p.active and p.role = 'admin');
$$;

-- an active user sees the team; only an admin changes anyone
create policy wm_profiles_read     on public.wm_profiles for select to authenticated
  using (id = auth.uid() or public.wm_is_active());
create policy wm_profiles_admin_up on public.wm_profiles for update to authenticated
  using (public.wm_is_admin()) with check (public.wm_is_admin());
-- the very first account may make itself administrator, and only while none exists
create policy wm_profiles_claim    on public.wm_profiles for insert to authenticated
  with check (id = auth.uid() and not exists (select 1 from public.wm_meta m where m.id = 'owner'));

-- anyone may ask whether setup is done; only the claiming administrator writes it
create policy wm_meta_read  on public.wm_meta for select to anon, authenticated using (true);
create policy wm_meta_claim on public.wm_meta for insert to authenticated
  with check (id = 'owner' and exists (select 1 from public.wm_profiles p
                                       where p.id = auth.uid() and p.role = 'admin' and p.active));
