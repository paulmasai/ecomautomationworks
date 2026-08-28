# Scheduled publishing

Phase 3 is implemented as a Cloudflare Cron handler that runs every five minutes. It publishes only approved and due Facebook posts, and every checked-in environment keeps outbound actions disabled.

## Safety gates

A Meta request is allowed only when all of the following are true:

1. `OUTBOUND_ACTIONS_ENABLED=true` in the deployed Worker environment.
2. `global_automation_enabled=true` in `automation_settings`.
3. `posting_enabled=true` in `automation_settings`.
4. `maintenance_mode=false` in `automation_settings`.
5. The post remains approved, due, unpublished, and atomically claimed.
6. The configured Page matches the post and its database record is active.
7. Any linked product is active and in stock.
8. The Page has not reached `maximum_daily_posts` for the current UTC day.
9. A single-image post uses the configured Supabase `product-images` public bucket over HTTPS, an allowed MIME type, and a known size no larger than `maximum_image_size_bytes`.

Safety switches are read directly from Supabase before the batch and again before every post. They are not cached across invocations because an emergency stop must take effect promptly.

## Attempts and failures

The Worker inserts a deterministic publication-attempt key before calling Meta. A duplicate attempt insert fails before a second Meta request can begin. Retryable failures use bounded delays and stop after three total attempts. Authentication, validation, rejected requests, invalid success responses, and unknown transport outcomes require human review.

An unknown transport outcome is deliberately not retried automatically: Meta may have created the post even if the Worker did not receive the response. Claims left in `processing` for more than fifteen minutes are recovered by migration `0004_scheduled_publishing.sql`, marked for human review, and never silently republished.

## Manual operations

Owners and automation managers with an `aal2` session can request publish-now, retry, or cancellation from the dashboard. Publish-now and retry make a post due for the Cron worker; they do not call Meta inside the dashboard request or bypass any safety gate. A post already being processed cannot be cancelled.

## Staging setup

1. Apply migrations `0001` through `0004`, then the seed.
2. Configure Supabase Auth and create the first owner profile.
3. Set all Worker secrets and replace `META_GRAPH_API_VERSION=v00.0` with a currently supported version.
4. Create the matching active `facebook_pages` row and an approved test post.
5. Confirm product-image URLs answer `HEAD` with `Content-Type` and `Content-Length` headers.
6. Deploy staging while `OUTBOUND_ACTIONS_ENABLED=false`, database switches are false, and maintenance mode is true.
7. Verify health, Auth, dashboard operations, Cron logs, and stale-claim recovery without outbound traffic.
8. For a controlled acceptance test, use a non-production Page, enable only the required posting switches, and explicitly enable the staging environment gate.
9. Confirm the Meta post ID, attempt ledger, audit event, daily limit, and kill-switch behavior before disabling outbound actions again.

Production must remain disabled until the staging acceptance test, Meta permissions/App Review, rollback procedure, and incident-response ownership are confirmed.
