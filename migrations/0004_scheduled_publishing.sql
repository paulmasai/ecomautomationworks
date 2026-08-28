begin;

create index facebook_posts_page_published_idx
  on public.facebook_posts (facebook_page_id, published_at desc)
  where status = 'published';

create or replace function public.recover_stale_facebook_post_claims(
  p_now timestamptz default timezone('utc', now())
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_post record;
  recovered_count integer := 0;
begin
  for stale_post in
    update public.facebook_posts
       set status = 'failed',
           last_error = 'publication_outcome_unknown',
           next_retry_at = null,
           processing_lock = null,
           locked_at = null
     where status = 'processing'
       and locked_at is not null
       and locked_at < p_now - interval '15 minutes'
    returning id, retry_count
  loop
    update public.post_publication_attempts
       set status = 'failed',
           error_code = 'publication_outcome_unknown',
           error_category = 'meta_transport_unknown',
           redacted_error_message = 'publication_outcome_unknown',
           completed_at = p_now
     where id = (
       select id
         from public.post_publication_attempts
        where facebook_post_id = stale_post.id
          and status = 'started'
        order by attempt_number desc
        limit 1
     );

    insert into public.automation_failures (
      operation,
      related_entity_type,
      related_entity_id,
      retryable,
      retry_count,
      maximum_retries,
      error_code,
      error_category,
      redacted_error_message,
      human_review_required
    )
    values (
      'facebook_post.publish',
      'facebook_post',
      stale_post.id,
      false,
      stale_post.retry_count,
      3,
      'publication_outcome_unknown',
      'meta_transport_unknown',
      'publication_outcome_unknown',
      true
    );

    insert into public.audit_logs (
      action,
      actor_type,
      entity_type,
      entity_id,
      metadata
    )
    values (
      'facebook_post_stale_claim_recovered',
      'system',
      'facebook_post',
      stale_post.id,
      jsonb_build_object('human_review_required', true)
    );

    recovered_count := recovered_count + 1;
  end loop;

  return recovered_count;
end;
$$;

revoke all on function public.recover_stale_facebook_post_claims(timestamptz)
  from public, anon, authenticated;
grant execute on function public.recover_stale_facebook_post_claims(timestamptz)
  to service_role;

commit;
