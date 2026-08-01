begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.facebook_pages (
  id uuid primary key default gen_random_uuid(),
  meta_page_id text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  model text,
  category text,
  processor text,
  ram text,
  storage text,
  graphics text,
  display text,
  description text,
  price numeric(12, 2) not null check (price >= 0),
  currency char(3) not null default 'KES',
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  stock_status text not null default 'unknown' check (
    stock_status in ('in_stock', 'low_stock', 'out_of_stock', 'reserved', 'unknown')
  ),
  product_condition text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  public_url text,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0),
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (product_id, storage_path)
);

create unique index product_images_one_primary_per_product_idx
  on public.product_images (product_id)
  where is_primary and active;

create table public.facebook_posts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  facebook_page_id uuid references public.facebook_pages(id) on delete restrict,
  caption text not null default '',
  image_url text,
  post_type text not null check (post_type in ('text', 'single_image')),
  status text not null default 'draft' check (
    status in (
      'draft', 'pending_approval', 'approved', 'scheduled', 'processing',
      'published', 'failed', 'cancelled'
    )
  ),
  approval_status text not null default 'pending' check (
    approval_status in ('pending', 'approved', 'rejected')
  ),
  scheduled_at timestamptz,
  published_at timestamptz,
  meta_page_id text,
  meta_post_id text,
  retry_count integer not null default 0 check (retry_count >= 0),
  last_error text,
  next_retry_at timestamptz,
  processing_lock uuid,
  locked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (post_type <> 'single_image' or image_url is not null),
  check (status <> 'published' or (meta_post_id is not null and published_at is not null))
);

create unique index facebook_posts_meta_post_id_idx
  on public.facebook_posts (meta_post_id)
  where meta_post_id is not null;

create index facebook_posts_due_idx
  on public.facebook_posts (scheduled_at, status)
  where status in ('approved', 'scheduled', 'failed');

create index facebook_posts_product_idx on public.facebook_posts (product_id);

create table public.post_publication_attempts (
  id uuid primary key default gen_random_uuid(),
  facebook_post_id uuid not null references public.facebook_posts(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  idempotency_key text not null unique,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  meta_post_id text,
  error_code text,
  error_category text,
  redacted_error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (facebook_post_id, attempt_number)
);

create table public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  external_event_id text not null unique,
  event_category text not null check (
    event_category in ('comment', 'messenger', 'mixed', 'page_event')
  ),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  payload_bytes integer not null check (payload_bytes > 0),
  processing_status text not null default 'received' check (
    processing_status in ('received', 'queued', 'processing', 'completed', 'failed', 'ignored')
  ),
  received_at timestamptz not null default timezone('utc', now()),
  queued_at timestamptz,
  processed_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  last_retry_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  locked_at timestamptz,
  processing_lock uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index meta_webhook_events_pending_idx
  on public.meta_webhook_events (processing_status, next_retry_at, received_at)
  where processing_status in ('received', 'queued', 'failed');

create table public.reply_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  intent text not null,
  channel text not null check (channel in ('facebook_comment', 'messenger')),
  body text not null check (length(trim(body)) > 0),
  language text not null default 'en',
  active boolean not null default true,
  approval_status text not null default 'pending' check (
    approval_status in ('pending', 'approved', 'rejected')
  ),
  version integer not null default 1 check (version > 0),
  variables text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (name, version)
);

create table public.reply_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  intent text not null check (
    intent in (
      'price', 'availability', 'location', 'delivery', 'specifications',
      'inbox_request', 'human_support', 'complaint', 'unknown', 'greeting',
      'product_interest', 'budget', 'preferences'
    )
  ),
  channel text not null check (channel in ('facebook_comment', 'messenger')),
  template_id uuid references public.reply_templates(id) on delete set null,
  priority integer not null default 100,
  match_terms text[] not null default '{}',
  requires_human boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.facebook_comments (
  id uuid primary key default gen_random_uuid(),
  meta_comment_id text not null unique,
  facebook_post_id uuid references public.facebook_posts(id) on delete set null,
  meta_post_id text not null,
  commenter_id text not null,
  commenter_name text,
  comment_text text not null,
  detected_intent text not null default 'unknown' check (
    detected_intent in (
      'price', 'availability', 'location', 'delivery', 'specifications',
      'inbox_request', 'human_support', 'complaint', 'unknown'
    )
  ),
  reply_status text not null default 'pending' check (
    reply_status in ('pending', 'replied', 'ignored', 'escalated', 'failed')
  ),
  human_handoff_required boolean not null default false,
  handoff_reason text,
  meta_created_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index facebook_comments_post_lookup_idx on public.facebook_comments (meta_post_id);
create index facebook_comments_commenter_lookup_idx on public.facebook_comments (commenter_id);
create index facebook_comments_handoff_idx
  on public.facebook_comments (created_at)
  where human_handoff_required and reply_status = 'escalated';

create table public.comment_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.facebook_comments(id) on delete cascade,
  reply_rule_id uuid references public.reply_rules(id) on delete set null,
  reply_template_id uuid references public.reply_templates(id) on delete set null,
  idempotency_key text not null unique,
  rendered_body text not null,
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'failed', 'cancelled')
  ),
  meta_reply_id text,
  sent_at timestamptz,
  error_category text,
  redacted_error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index comment_replies_meta_reply_id_idx
  on public.comment_replies (meta_reply_id)
  where meta_reply_id is not null;

create table public.messenger_contacts (
  id uuid primary key default gen_random_uuid(),
  meta_sender_id text not null unique,
  display_name text,
  anonymized_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.messenger_contacts(id) on delete cascade,
  conversation_state text not null default 'automation_active' check (
    conversation_state in (
      'automation_active', 'human_required', 'human_assigned', 'resolved', 'closed'
    )
  ),
  last_customer_interaction_at timestamptz,
  automation_enabled boolean not null default true,
  human_handoff_required boolean not null default false,
  handoff_reason text,
  handoff_at timestamptz,
  collected_sales_information jsonb not null default '{}'::jsonb,
  last_intent text,
  automated_reply_count integer not null default 0 check (automated_reply_count >= 0),
  repeated_question_count integer not null default 0 check (repeated_question_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (contact_id)
);

create index messenger_conversations_open_idx
  on public.messenger_conversations (last_customer_interaction_at desc)
  where conversation_state in ('automation_active', 'human_required', 'human_assigned');

create table public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  meta_message_id text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null default 'text',
  message_text text,
  raw_payload jsonb,
  detected_intent text,
  automated boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index messenger_messages_conversation_idx
  on public.messenger_messages (conversation_id, created_at desc);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_identifier text not null,
  customer_name text,
  product_interest text,
  budget numeric(12, 2) check (budget is null or budget >= 0),
  ram_preference text,
  storage_preference text,
  location text,
  phone_number text,
  source text not null check (source in ('facebook_comment', 'messenger')),
  conversation_id uuid references public.messenger_conversations(id) on delete set null,
  follow_up_status text not null default 'new' check (
    follow_up_status in ('new', 'contacted', 'qualified', 'closed', 'not_interested')
  ),
  assigned_staff_member text,
  anonymized_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index leads_one_per_conversation_idx
  on public.leads (conversation_id)
  where conversation_id is not null;
create index leads_follow_up_idx on public.leads (follow_up_status, created_at);
create index leads_customer_lookup_idx on public.leads (customer_identifier);

create table public.automation_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.automation_reference_values (
  category text not null,
  value text not null,
  label text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (category, value)
);

create table public.automation_failures (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  related_entity_type text,
  related_entity_id uuid,
  retryable boolean not null,
  retry_count integer not null default 0 check (retry_count >= 0),
  maximum_retries integer not null default 5 check (maximum_retries >= 0),
  last_retry_at timestamptz,
  next_retry_at timestamptz,
  error_code text,
  error_category text not null,
  redacted_error_message text,
  human_review_required boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index automation_failures_retry_idx
  on public.automation_failures (next_retry_at, retry_count)
  where retryable and resolved_at is null;
create index automation_failures_review_idx
  on public.automation_failures (created_at)
  where human_review_required and resolved_at is null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_type text not null check (actor_type in ('system', 'administrator', 'meta')),
  actor_identifier text,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default timezone('utc', now())
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create trigger facebook_pages_set_updated_at
before update on public.facebook_pages
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger product_images_set_updated_at
before update on public.product_images
for each row execute function public.set_updated_at();

create trigger facebook_posts_set_updated_at
before update on public.facebook_posts
for each row execute function public.set_updated_at();

create trigger meta_webhook_events_set_updated_at
before update on public.meta_webhook_events
for each row execute function public.set_updated_at();

create trigger reply_templates_set_updated_at
before update on public.reply_templates
for each row execute function public.set_updated_at();

create trigger reply_rules_set_updated_at
before update on public.reply_rules
for each row execute function public.set_updated_at();

create trigger facebook_comments_set_updated_at
before update on public.facebook_comments
for each row execute function public.set_updated_at();

create trigger comment_replies_set_updated_at
before update on public.comment_replies
for each row execute function public.set_updated_at();

create trigger messenger_contacts_set_updated_at
before update on public.messenger_contacts
for each row execute function public.set_updated_at();

create trigger messenger_conversations_set_updated_at
before update on public.messenger_conversations
for each row execute function public.set_updated_at();

create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

create trigger automation_settings_set_updated_at
before update on public.automation_settings
for each row execute function public.set_updated_at();

create trigger automation_failures_set_updated_at
before update on public.automation_failures
for each row execute function public.set_updated_at();

create or replace function public.ingest_meta_webhook_event(
  p_external_event_id text,
  p_event_category text,
  p_raw_payload jsonb,
  p_payload_bytes integer
)
returns table (event_id uuid, is_duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
begin
  if p_event_category not in ('comment', 'messenger', 'mixed', 'page_event') then
    raise exception 'Invalid event category';
  end if;

  if p_payload_bytes <= 0 or p_payload_bytes > 262144 then
    raise exception 'Invalid payload size';
  end if;

  insert into public.meta_webhook_events (
    external_event_id,
    event_category,
    raw_payload,
    payload_bytes
  )
  values (
    p_external_event_id,
    p_event_category,
    p_raw_payload,
    p_payload_bytes
  )
  on conflict (external_event_id) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return query select inserted_id, false;
    return;
  end if;

  select id
    into inserted_id
    from public.meta_webhook_events
   where external_event_id = p_external_event_id;

  return query select inserted_id, true;
end;
$$;

create or replace function public.claim_due_facebook_posts(
  p_limit integer default 10,
  p_now timestamptz default timezone('utc', now())
)
returns setof public.facebook_posts
language sql
security definer
set search_path = public
as $$
  with due as (
    select id
      from public.facebook_posts
     where status in ('approved', 'scheduled', 'failed')
       and approval_status = 'approved'
       and scheduled_at is not null
       and scheduled_at <= p_now
       and published_at is null
       and meta_post_id is null
       and (next_retry_at is null or next_retry_at <= p_now)
       and (locked_at is null or locked_at < p_now - interval '10 minutes')
     order by scheduled_at asc
     limit greatest(1, least(p_limit, 50))
     for update skip locked
  )
  update public.facebook_posts as post
     set status = 'processing',
         processing_lock = gen_random_uuid(),
         locked_at = p_now
    from due
   where post.id = due.id
  returning post.*;
$$;

create or replace function public.claim_pending_webhook_events(
  p_limit integer default 25,
  p_now timestamptz default timezone('utc', now())
)
returns setof public.meta_webhook_events
language sql
security definer
set search_path = public
as $$
  with pending as (
    select id
      from public.meta_webhook_events
     where processing_status in ('received', 'queued', 'failed')
       and (next_retry_at is null or next_retry_at <= p_now)
       and (locked_at is null or locked_at < p_now - interval '10 minutes')
     order by received_at asc
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.meta_webhook_events as event
     set processing_status = 'processing',
         processing_lock = gen_random_uuid(),
         locked_at = p_now
    from pending
   where event.id = pending.id
  returning event.*;
$$;

alter table public.facebook_pages enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.facebook_posts enable row level security;
alter table public.post_publication_attempts enable row level security;
alter table public.meta_webhook_events enable row level security;
alter table public.reply_templates enable row level security;
alter table public.reply_rules enable row level security;
alter table public.facebook_comments enable row level security;
alter table public.comment_replies enable row level security;
alter table public.messenger_contacts enable row level security;
alter table public.messenger_conversations enable row level security;
alter table public.messenger_messages enable row level security;
alter table public.leads enable row level security;
alter table public.automation_settings enable row level security;
alter table public.automation_reference_values enable row level security;
alter table public.automation_failures enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all functions in schema public from public;
grant all on all tables in schema public to service_role;
grant execute on function public.ingest_meta_webhook_event(text, text, jsonb, integer) to service_role;
grant execute on function public.claim_due_facebook_posts(integer, timestamptz) to service_role;
grant execute on function public.claim_pending_webhook_events(integer, timestamptz) to service_role;

commit;
