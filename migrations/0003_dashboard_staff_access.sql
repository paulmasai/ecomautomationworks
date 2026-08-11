begin;

create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  role text not null check (
    role in ('owner', 'automation_manager', 'content_editor', 'support_agent', 'auditor')
  ),
  status text not null default 'invited' check (
    status in ('invited', 'active', 'suspended')
  ),
  invited_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  last_signed_in_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index staff_profiles_email_idx on public.staff_profiles (lower(email));
create index staff_profiles_status_role_idx on public.staff_profiles (status, role);

alter table public.facebook_posts
  add column created_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  add column approved_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  add column approved_at timestamptz;

alter table public.messenger_conversations
  add column assigned_to_staff_id uuid references public.staff_profiles(id) on delete set null;

alter table public.leads
  add column assigned_to_staff_id uuid references public.staff_profiles(id) on delete set null;

alter table public.automation_failures
  add column resolved_by_staff_id uuid references public.staff_profiles(id) on delete set null;

create trigger staff_profiles_set_updated_at
before update on public.staff_profiles
for each row execute function public.set_updated_at();

alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from anon, authenticated;
grant all on public.staff_profiles to service_role;

commit;
