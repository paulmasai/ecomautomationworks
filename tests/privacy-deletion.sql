-- Run only in a disposable database after the migrations. Every fixture rolls back.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
insert into public.staff_profiles(user_id, email, display_name, role, status)
values ('10000000-0000-4000-8000-000000000001', 'owner@example.com', 'Test owner', 'owner', 'active');
insert into public.facebook_pages(meta_page_id, name) values ('999999', 'Test page');
insert into public.messenger_contacts(id, meta_sender_id) values
('20000000-0000-4000-8000-000000000001', '123'),
('20000000-0000-4000-8000-000000000002', '1234');
insert into public.messenger_conversations(id, contact_id) values
('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');
insert into public.messenger_messages(conversation_id, meta_message_id, direction, message_text) values
('30000000-0000-4000-8000-000000000001', 'message-one', 'inbound', 'Private message'),
('30000000-0000-4000-8000-000000000002', 'message-two', 'inbound', 'Keep me');
insert into public.leads(customer_identifier, customer_name, source, conversation_id)
values ('other-alias', 'Private name', 'messenger', '30000000-0000-4000-8000-000000000001');
insert into public.facebook_comments(id, meta_comment_id, meta_post_id, commenter_id, comment_text)
values ('40000000-0000-4000-8000-000000000001', 'comment-one', 'post-one', '123', 'Private comment');
insert into public.comment_replies(comment_id, idempotency_key, rendered_body)
values ('40000000-0000-4000-8000-000000000001', 'reply-one', 'Private reply');
insert into public.meta_webhook_events(id, external_event_id, event_category, raw_payload, payload_bytes) values
('50000000-0000-4000-8000-000000000001', 'mixed', 'mixed', '{"entry":[{"messaging":[{"sender":{"id":"123"}},{"sender":{"id":"1234"}}]}]}', 100),
('50000000-0000-4000-8000-000000000002', 'unrelated', 'messenger', '{"entry":[{"messaging":[{"sender":{"id":"1234"}}]}]}', 100),
('50000000-0000-4000-8000-000000000003', 'numeric', 'messenger', '{"sender":{"id":123}}', 20);
insert into public.audit_logs(action, actor_type, entity_id, metadata)
values ('customer_updated', 'system', '30000000-0000-4000-8000-000000000001', '{"name":"Private name"}');
insert into public.automation_failures(operation, related_entity_id, retryable, error_category)
values ('customer_reply', '30000000-0000-4000-8000-000000000001', true, 'transient');

select public.register_data_deletion_request(repeat('a', 64), 'meta', null, null, '888', 'app-test');
select public.register_data_deletion_request(repeat('a', 64), 'meta', null, null, '888', 'app-test');

-- Force a failure after data removal; a subtransaction must restore every row.
create function public.test_privacy_failure() returns trigger language plpgsql as $$
begin if new.action = 'personal_data_deleted' then raise exception 'simulated failure'; end if; return new; end;
$$;
create trigger test_privacy_failure before insert on public.audit_logs for each row execute function public.test_privacy_failure();
do $$
declare request_id uuid;
begin
  select id into request_id from public.data_deletion_requests where receipt_hash = repeat('a', 64);
  begin
    perform public.complete_data_deletion_request(request_id, array['123'], 'verified_meta_mapping', '10000000-0000-4000-8000-000000000001');
    raise exception 'Expected deletion failure';
  exception when others then
    if sqlerrm <> 'simulated failure' then raise; end if;
  end;
  assert exists (select 1 from public.messenger_contacts where meta_sender_id = '123'), 'Failed deletion removed contact';
  assert exists (select 1 from public.data_deletion_requests where id = request_id and status = 'pending'), 'Failed deletion marked complete';
  assert not exists (select 1 from public.data_deletion_suppressions), 'Failed deletion left suppression';
end;
$$;
drop trigger test_privacy_failure on public.audit_logs;
drop function public.test_privacy_failure();

do $$
declare request_id uuid;
begin
  assert (select count(*) from public.data_deletion_requests) = 1, 'Callback retry duplicated request';
  select id into request_id from public.data_deletion_requests where receipt_hash = repeat('a', 64);
  perform public.complete_data_deletion_request(request_id, array['123'], 'verified_meta_mapping', '10000000-0000-4000-8000-000000000001');
  perform public.complete_data_deletion_request(request_id, array['123'], 'verified_meta_mapping', '10000000-0000-4000-8000-000000000001');
  assert not exists (select 1 from public.messenger_contacts where meta_sender_id = '123'), 'Contact retained';
  assert not exists (select 1 from public.messenger_messages where meta_message_id = 'message-one'), 'Message retained';
  assert not exists (select 1 from public.messenger_conversations where id = '30000000-0000-4000-8000-000000000001'), 'Conversation retained';
  assert not exists (select 1 from public.leads), 'Linked lead retained';
  assert not exists (select 1 from public.facebook_comments), 'Comment retained';
  assert not exists (select 1 from public.comment_replies), 'Reply retained';
  assert not exists (select 1 from public.meta_webhook_events where external_event_id in ('mixed', 'numeric')), 'Raw payload retained';
  assert exists (select 1 from public.meta_webhook_events where external_event_id = 'unrelated'), 'Substring match removed another person';
  assert exists (select 1 from public.messenger_messages where meta_message_id = 'message-two'), 'Other contact deleted';
  assert not exists (select 1 from public.automation_failures), 'Failure reference retained';
  assert (select count(*) from public.audit_logs) = 1, 'Audit purge or idempotency failed';
  assert exists (select 1 from public.data_deletion_requests where status = 'completed' and contact is null and reference is null and meta_user_id is null), 'Request not minimized';
  assert exists (select 1 from public.data_deletion_suppressions where subject_hash = encode(sha256(convert_to('123', 'UTF8')), 'hex')), 'Suppression missing';
end;
$$;

select public.ingest_meta_webhook_event('retry', 'messenger', '{"entry":[{"messaging":[{"sender":{"id":"123"}}]}]}', 100);
do $$ begin
  assert exists (select 1 from public.meta_webhook_events where external_event_id = 'retry' and raw_payload = '{}' and processing_status = 'ignored'), 'Retry reintroduced personal data';
  assert not has_table_privilege('anon', 'public.data_deletion_requests', 'SELECT'), 'Anonymous request access';
  assert not has_table_privilege('authenticated', 'public.data_deletion_suppressions', 'SELECT'), 'Authenticated suppression access';
  assert not has_function_privilege('anon', 'public.complete_data_deletion_request(uuid,text[],text,uuid)', 'EXECUTE'), 'Public deletion RPC';
  assert not has_function_privilege('authenticated', 'public.apply_privacy_retention()', 'EXECUTE'), 'Public retention RPC';
  assert (select relrowsecurity from pg_class where oid = 'public.data_deletion_requests'::regclass), 'Missing RLS';
end; $$;

-- Old raw data and receipts expire, pending requests remain reviewable.
update public.meta_webhook_events set received_at = now() - interval '31 days';
update public.data_deletion_requests set completed_at = now() - interval '91 days';
update public.data_deletion_suppressions set expires_at = now() - interval '1 day';
select public.register_data_deletion_request(repeat('b', 64), 'website', 'pending@example.com', 'Still waiting', null, null);
update public.data_deletion_requests set created_at = now() - interval '40 days' where receipt_hash = repeat('b', 64);
do $$ declare result jsonb; begin
  select public.apply_privacy_retention() into result;
  assert result->>'overdue_requests' = '1', 'Overdue request not reported';
  assert not exists (select 1 from public.meta_webhook_events), 'Raw retention failed';
  assert not exists (select 1 from public.data_deletion_requests where status = 'completed'), 'Receipt retention failed';
  assert exists (select 1 from public.data_deletion_requests where status = 'pending'), 'Unresolved request silently dropped';
  assert not exists (select 1 from public.data_deletion_suppressions), 'Suppression retention failed';
end; $$;
rollback;

begin;
do $$ declare result jsonb; begin
  for i in 1..5 loop
    select public.register_data_deletion_request(lpad(i::text, 64, '0'), 'website', 'test@example.com', 'Test reference', null, null, repeat('c', 64)) into result;
    assert result->>'status' = 'received', 'Allowed submission rejected';
  end loop;
  select public.register_data_deletion_request(repeat('d', 64), 'website', 'test@example.com', 'Test reference', null, null, repeat('c', 64)) into result;
  assert result->>'status' = 'rate_limited', 'Durable rate limit not enforced';
  assert (select count(*) from public.data_deletion_requests) = 5, 'Rate-limited request stored';
  update public.privacy_request_rate_limits set window_started_at = now() - interval '2 hours';
  select public.register_data_deletion_request(repeat('d', 64), 'website', 'test@example.com', 'Test reference', null, null, repeat('c', 64)) into result;
  assert result->>'status' = 'received', 'Expired rate window did not reset';
  assert not has_table_privilege('anon', 'public.privacy_request_rate_limits', 'SELECT'), 'Public rate identifier access';
end; $$;
rollback;
