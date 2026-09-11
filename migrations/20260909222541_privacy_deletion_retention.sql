begin;

create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  receipt_hash text not null unique check (receipt_hash ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('meta', 'website')),
  contact text check (length(contact) <= 254),
  reference text check (length(reference) <= 1000),
  meta_user_id text check (meta_user_id ~ '^[0-9]{1,100}$'),
  meta_app_id text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  verification text check (verification in ('existing_channel', 'verified_meta_mapping')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'pending' and completed_at is null) or (status = 'completed' and completed_at is not null))
);
create index data_deletion_requests_pending_idx on public.data_deletion_requests (created_at) where status = 'pending';

-- These hashes remain personal data; restrict access and expire them.
create table public.data_deletion_suppressions (
  subject_hash text primary key check (subject_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default now() + interval '90 days'
);
create index data_deletion_suppressions_expiry_idx on public.data_deletion_suppressions (expires_at);
create table public.privacy_request_rate_limits (
  requester_hash text primary key check (requester_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1
);
alter table public.privacy_request_rate_limits enable row level security;
alter table public.data_deletion_requests enable row level security;
alter table public.data_deletion_suppressions enable row level security;
revoke all on public.data_deletion_requests, public.data_deletion_suppressions from public, anon, authenticated;
grant select, insert, update, delete on public.data_deletion_requests, public.data_deletion_suppressions to service_role;
revoke all on public.privacy_request_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.privacy_request_rate_limits to service_role;

create function public.privacy_payload_matches(p_payload jsonb, p_ids text[])
returns boolean language sql immutable security invoker set search_path = '' as $$
  select exists (
    select 1 from pg_catalog.jsonb_path_query(p_payload, 'strict $.**') as value
    where pg_catalog.jsonb_typeof(value) in ('string', 'number') and value #>> '{}' = any(p_ids)
  );
$$;

create function public.register_data_deletion_request(
  p_receipt_hash text, p_source text, p_contact text, p_reference text,
  p_meta_user_id text, p_meta_app_id text, p_requester_hash text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare total integer;
begin
  if (p_source = 'website' and (p_contact is null or p_reference is null))
     or (p_source = 'meta' and (p_meta_user_id is null or p_meta_app_id is null)) then
    raise exception 'Missing request details';
  end if;
  if p_source = 'website' and p_requester_hash is not null then
    insert into public.privacy_request_rate_limits(requester_hash) values (p_requester_hash)
      on conflict (requester_hash) do update set
        request_count = case when privacy_request_rate_limits.window_started_at < now() - interval '1 hour' then 1 else least(privacy_request_rate_limits.request_count + 1, 6) end,
        window_started_at = case when privacy_request_rate_limits.window_started_at < now() - interval '1 hour' then now() else privacy_request_rate_limits.window_started_at end
      returning request_count into total;
    if total > 5 then return jsonb_build_object('status', 'rate_limited'); end if;
  end if;
  insert into public.data_deletion_requests (receipt_hash, source, contact, reference, meta_user_id, meta_app_id)
  values (p_receipt_hash, p_source, p_contact, p_reference, p_meta_user_id, p_meta_app_id)
  on conflict (receipt_hash) do nothing;
  return jsonb_build_object('status', 'received');
end;
$$;

-- Serialize ingress with erasure so an in-flight delivery cannot recreate data.
-- Consumers for future comment/Messenger automation must honor the same lock
-- and suppression check before materializing or sending customer data.
create function public.suppress_deleted_meta_delivery()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(76201401);
  if exists (
    select 1 from pg_catalog.jsonb_path_query(new.raw_payload, 'strict $.**') as value
    join public.data_deletion_suppressions s
      on s.subject_hash = encode(sha256(convert_to(value #>> '{}', 'UTF8')), 'hex')
    where pg_catalog.jsonb_typeof(value) in ('string', 'number') and s.expires_at > now()
  ) then
    new.raw_payload := '{}'::jsonb;
    new.processing_status := 'ignored';
    new.processed_at := now();
    new.last_error := null;
  end if;
  return new;
end;
$$;
create trigger suppress_deleted_meta_delivery before insert on public.meta_webhook_events
for each row execute function public.suppress_deleted_meta_delivery();

-- Return the suppression result so ignored deliveries never enter a Queue.
drop function public.ingest_meta_webhook_event(text, text, jsonb, integer);
create function public.ingest_meta_webhook_event(
  p_external_event_id text, p_event_category text, p_raw_payload jsonb, p_payload_bytes integer
) returns table (event_id uuid, is_duplicate boolean, is_ignored boolean)
language plpgsql security invoker set search_path = '' as $$
declare inserted_id uuid; ignored boolean;
begin
  if p_payload_bytes <= 0 or p_payload_bytes > 262144 then raise exception 'Invalid payload size'; end if;
  insert into public.meta_webhook_events(external_event_id, event_category, raw_payload, payload_bytes)
  values (p_external_event_id, p_event_category, p_raw_payload, p_payload_bytes)
  on conflict (external_event_id) do nothing
  returning id, processing_status = 'ignored' into inserted_id, ignored;
  if inserted_id is not null then
    return query select inserted_id, false, ignored;
  else
    return query select e.id, true, e.processing_status = 'ignored' from public.meta_webhook_events e where e.external_event_id = p_external_event_id;
  end if;
end;
$$;
revoke all on function public.ingest_meta_webhook_event(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ingest_meta_webhook_event(text, text, jsonb, integer) to service_role;

create function public.complete_data_deletion_request(
  p_request_id uuid, p_subject_ids text[], p_verification text, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  request_row public.data_deletion_requests%rowtype;
  entity_ids uuid[];
begin
  if cardinality(p_subject_ids) not between 1 and 20 or p_subject_ids is null
    or exists (select 1 from unnest(p_subject_ids) s where s is null or s !~ '^[0-9]{1,100}$')
    or p_verification is null or p_verification not in ('existing_channel', 'verified_meta_mapping') then
    raise exception 'Invalid verification';
  end if;
  if not exists (select 1 from public.staff_profiles where user_id = p_actor_id and role = 'owner' and status = 'active') then
    raise exception 'Active owner required';
  end if;
  if exists (select 1 from public.facebook_pages where meta_page_id = any(p_subject_ids)) then
    raise exception 'Page identifier is not a person';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(76201401);
  select * into request_row from public.data_deletion_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if request_row.status = 'completed' then return jsonb_build_object('status', 'completed'); end if;

  -- Collect links before cascades remove conversations, messages, and replies.
  select coalesce(array_agg(id), '{}'::uuid[]) into entity_ids from (
    select id from public.facebook_comments where commenter_id = any(p_subject_ids)
    union select r.id from public.comment_replies r join public.facebook_comments c on c.id = r.comment_id where c.commenter_id = any(p_subject_ids)
    union select id from public.messenger_contacts where meta_sender_id = any(p_subject_ids)
    union select c.id from public.messenger_conversations c join public.messenger_contacts m on m.id = c.contact_id where m.meta_sender_id = any(p_subject_ids)
    union select m.id from public.messenger_messages m join public.messenger_conversations c on c.id = m.conversation_id join public.messenger_contacts p on p.id = c.contact_id where p.meta_sender_id = any(p_subject_ids) or public.privacy_payload_matches(m.raw_payload, p_subject_ids)
    union select l.id from public.leads l left join public.messenger_conversations c on c.id = l.conversation_id left join public.messenger_contacts m on m.id = c.contact_id where l.customer_identifier = any(p_subject_ids) or m.meta_sender_id = any(p_subject_ids)
    union select id from public.meta_webhook_events where public.privacy_payload_matches(raw_payload, p_subject_ids)
  ) as related;

  insert into public.data_deletion_suppressions(subject_hash)
    select encode(sha256(convert_to(s, 'UTF8')), 'hex') from (select distinct unnest(p_subject_ids) s) subjects
    on conflict (subject_hash) do update set expires_at = now() + interval '90 days';
  delete from public.automation_failures where related_entity_id = any(entity_ids);
  delete from public.audit_logs where entity_id = any(entity_ids) or actor_identifier = any(p_subject_ids)
    or public.privacy_payload_matches(metadata, p_subject_ids);
  delete from public.leads where id = any(entity_ids);
  delete from public.facebook_comments where commenter_id = any(p_subject_ids);
  delete from public.messenger_contacts where meta_sender_id = any(p_subject_ids);
  -- Remove full deliveries containing the subject, including multi-person batches.
  delete from public.meta_webhook_events where id = any(entity_ids);
  -- Remove embedded references even when a message belongs to another contact.
  delete from public.messenger_messages where public.privacy_payload_matches(raw_payload, p_subject_ids);

  update public.data_deletion_requests set status = 'completed', completed_at = now(),
    verification = p_verification, contact = null, reference = null, meta_user_id = null, meta_app_id = null
    where id = p_request_id;
  insert into public.audit_logs(action, actor_type, actor_identifier, entity_type, entity_id, metadata)
    values ('personal_data_deleted', 'administrator', p_actor_id::text, 'data_deletion_request', p_request_id,
      jsonb_build_object('verification', p_verification));
  return jsonb_build_object('status', 'completed');
end;
$$;

create index meta_webhook_events_retention_idx on public.meta_webhook_events(received_at);
create index facebook_comments_retention_idx on public.facebook_comments(created_at);
create index messenger_messages_retention_idx on public.messenger_messages(created_at);
create index leads_retention_idx on public.leads(created_at);

create function public.apply_privacy_retention()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare overdue bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(76201401);
  delete from public.meta_webhook_events where received_at < now() - interval '30 days';
  delete from public.facebook_comments where created_at < now() - interval '90 days';
  delete from public.messenger_messages where created_at < now() - interval '90 days';
  delete from public.leads where created_at < now() - interval '90 days';
  delete from public.messenger_contacts p where
    greatest(p.created_at,
      coalesce((select max(greatest(c.created_at, c.last_customer_interaction_at,
        (select max(m.created_at) from public.messenger_messages m where m.conversation_id = c.id)))
        from public.messenger_conversations c where c.contact_id = p.id), p.created_at)) < now() - interval '90 days';
  delete from public.automation_failures where created_at < now() - interval '30 days';
  delete from public.audit_logs where created_at < now() - interval '30 days';
  delete from public.data_deletion_requests where completed_at < now() - interval '90 days';
  delete from public.data_deletion_suppressions where expires_at <= now();
  delete from public.privacy_request_rate_limits where window_started_at < now() - interval '1 day';
  select count(*) into overdue from public.data_deletion_requests where status = 'pending' and created_at + interval '1 month' < now();
  return jsonb_build_object('overdue_requests', overdue);
end;
$$;

revoke all on function public.privacy_payload_matches(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.register_data_deletion_request(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.suppress_deleted_meta_delivery() from public, anon, authenticated;
revoke all on function public.complete_data_deletion_request(uuid, text[], text, uuid) from public, anon, authenticated;
revoke all on function public.apply_privacy_retention() from public, anon, authenticated;
grant execute on function public.privacy_payload_matches(jsonb, text[]) to service_role;
grant execute on function public.register_data_deletion_request(text, text, text, text, text, text, text) to service_role;
grant execute on function public.suppress_deleted_meta_delivery() to service_role;
grant execute on function public.complete_data_deletion_request(uuid, text[], text, uuid) to service_role;
grant execute on function public.apply_privacy_retention() to service_role;

commit;
