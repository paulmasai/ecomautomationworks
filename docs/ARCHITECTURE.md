# Architecture

## System boundary

This repository is an independent Cloudflare Worker. Supabase Studio is the administrative interface and Meta Business Suite is the human-support interface. There is no public website, custom dashboard, custom inbox, or always-running server.

```text
Supabase Studio
  products, images, post schedules, templates, rules, settings, failures, leads
        |
        v
Supabase PostgreSQL + Storage <------> Cloudflare Worker
                                         | HTTP: webhook ingress/internal routes
                                         | Cron: due posts and retry batches
                                         | Queue: asynchronous Meta events
                                         v
                                    Meta Graph API
                                         |
                                         v
                              Facebook Page + Messenger
                                         |
                                         v
                                 Meta Business Suite
```

## Runtime components

- Router: exposes only health, Meta webhook, and authenticated internal operations routes.
- Configuration: validates every Worker binding with Zod and never reports secret values.
- Webhook ingress: verifies the exact raw body with `X-Hub-Signature-256`, validates the JSON shape, atomically stores it, and acknowledges Meta quickly.
- Durable event ledger: `meta_webhook_events` is both the audit source and database queue fallback. Queue availability is an optimization, not a durability requirement.
- Queue processors: normalize comment and Messenger events and invoke the appropriate rule-based automation. These arrive in phases 4 and 5.
- Scheduled publisher: Cron claims a bounded batch with `FOR UPDATE SKIP LOCKED`, checks settings/product state, and calls Meta. This arrives in phase 3.
- Retry processor: claims only due retryable failures, applies bounded exponential backoff, and sends non-retryable failures to human review.
- Meta client: owns Graph API request validation, timeouts, response schemas, and error classification.
- Supabase access: uses REST/RPC through Worker-native `fetch`; no Node.js-only API is required.

## Request flow

### Meta verification

1. Meta calls `GET /webhooks/meta` with mode, token, and challenge.
2. The Worker compares the supplied token in constant time.
3. A valid request receives only the challenge; an invalid request receives a generic 403 response.

### Meta delivery

1. Read a maximum 256 KiB raw request body.
2. Verify the HMAC-SHA256 signature before decoding JSON.
3. Validate the Page webhook envelope with Zod.
4. Hash the raw delivery and call `ingest_meta_webhook_event`.
5. PostgreSQL inserts once under a unique external ID or reports a duplicate.
6. If a Queue binding is available, dispatch after persistence using `waitUntil`.
7. If Queue dispatch is absent or fails, retain the event for the database retry processor.
8. Return `EVENT_RECEIVED` without exposing database or configuration data.

### Scheduled publication (phase 3)

1. Cron loads automation controls and the current daily count.
2. `claim_due_facebook_posts` atomically locks a small due batch.
3. The publisher validates the post, linked product, stock, caption, image, and Page configuration.
4. A publication-attempt idempotency key is inserted before the Meta call.
5. Meta receives either a text post or one image post.
6. Success stores the Meta post ID and audit event; failure is classified and scheduled or escalated.

## Database design

| Area | Tables | Important protections |
| --- | --- | --- |
| Catalogue | `products`, `product_images` | stock checks, non-negative values, one primary image |
| Pages/posts | `facebook_pages`, `facebook_posts`, `post_publication_attempts` | unique Meta post IDs, atomic locks, unique attempt keys |
| Ingress | `meta_webhook_events` | unique delivery fingerprint, indexed pending states |
| Comments | `facebook_comments`, `comment_replies` | unique Meta comment/reply IDs and reply idempotency keys |
| Messenger | `messenger_contacts`, `messenger_conversations`, `messenger_messages` | unique sender/message IDs, one current conversation per contact |
| Automation | `reply_templates`, `reply_rules`, `automation_settings`, `automation_reference_values` | approval flags, versioned templates, Studio-friendly states, outbound kill switches |
| Sales/operations | `leads`, `automation_failures`, `audit_logs` | one lead per conversation, retry/review indexes, immutable audit records |

All application timestamps are `timestamptz` and represent UTC. Administrators convert Africa/Nairobi input to UTC when setting `scheduled_at`; setup guidance will include a safe workflow for this.

## Idempotency

- Webhook delivery: SHA-256 fingerprint of the exact verified body, unique in `meta_webhook_events`.
- Comments: unique Meta comment ID.
- Messenger: unique Meta message ID.
- Scheduled posts: atomic status transition plus `processing_lock`, unique Meta post ID, and unique publication attempt key.
- Comment replies: unique application idempotency key derived from page post, commenter, and rule.
- Leads: at most one lead per Messenger conversation.

The application checks are paired with database uniqueness constraints so concurrency cannot bypass them.

## Security and privacy boundaries

- Only Meta webhooks and health are public in release one.
- Internal operations require a separate secret and rate limiting.
- The Supabase service-role key exists only as a Cloudflare secret because there is no browser client.
- RLS is enabled on every application table; anon and authenticated roles receive no grants.
- Product images are public only so Meta can fetch explicitly published URLs. Public upload/update/delete policies are not created.
- Raw webhook content is never logged. Tokens, secrets, authorization values, message bodies, and phone fields are redacted by key.
- Retention and anonymization operations will be implemented in phase 6.

## Assumptions

- Release one supports exactly one business and one Facebook Page.
- Products are entered manually through Supabase Studio.
- Product assets are uploaded manually to the `product-images` bucket.
- Page schedules are stored in UTC after considering Africa/Nairobi local time.
- Meta Business Suite is the source of truth for human conversation work.
- Rule-based intent matching is deterministic; AI is out of scope.
- Queue configuration may vary by Cloudflare plan, so the persisted database fallback is mandatory.
- Staging and all checked-in environments start with outbound actions disabled.

## Manual platform actions

### Meta

- Create and configure the Meta developer app.
- Add the Facebook Page and generate the correct Page access token.
- Select a supported Graph API version in `META_GRAPH_API_VERSION`.
- Configure the callback URL and verification token.
- Subscribe to required Page feed/comment and Messenger fields.
- Grant/test required permissions and complete App Review where Meta requires it.
- Enable live mode only after staging verification and human approval.

### Supabase

- Create the project and apply migrations/seeds in order.
- Confirm the `product-images` bucket configuration.
- Create real products, images, templates, and approved post schedules.
- Keep the example product inactive or remove it.

### Cloudflare

- Create Worker environments and set every secret with Wrangler or the dashboard.
- Add the Cron Trigger when phase 3 is present.
- Create and bind the Queue when the event consumer is present.
- Configure production routes, logs, rollback access, and edge rate limiting.
