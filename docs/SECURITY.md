# Security baseline

## Secrets

The following values must be Cloudflare Worker secrets and must never be committed: `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN`, and `INTERNAL_ADMIN_SECRET`. `SUPABASE_PUBLISHABLE_KEY` is intentionally browser-safe but should still be supplied through environment configuration rather than hard-coded into source.

The `.env.example` file contains placeholders only. Local values belong in the ignored `.dev.vars` file.

## Why the Worker uses the service-role credential

The staff dashboard uses the Supabase publishable key only for Auth. It sends the resulting access token to the Worker, which validates the user, active staff profile, permission, and MFA level before performing trusted server-side inserts, atomic RPC calls, and automation updates. The service-role key bypasses RLS by design, so compromise would grant broad database access. The key is therefore restricted to Cloudflare secrets, never returned by a route, and never written to logs. Rotation is required after suspected exposure.

## Webhook trust model

Webhook input remains untrusted even when it is transported over HTTPS. The Worker:

1. Caps the raw body size.
2. Verifies `X-Hub-Signature-256` against the exact bytes using the app secret.
3. Rejects unsigned or incorrectly signed bodies before JSON parsing.
4. Validates the parsed shape with Zod.
5. Uses a delivery fingerprint and database uniqueness constraint for replay safety.
6. Logs only identifiers and result metadata, never the payload.

## Database access

RLS is enabled for all application tables, including staff profiles. No anon/authenticated table or function access is granted; the authenticated dashboard reaches application data only through the Worker admin API. Supabase Studio administration occurs through trusted project accounts. The public product image bucket permits reads required by Meta but does not include public upload, update, or delete policies.

## Outbound safety

Database settings independently control global, posting, comment, and Messenger automation. `OUTBOUND_ACTIONS_ENABLED` is a second deployment-level gate. Both must allow an action before the publisher or a future replier may call Meta. The publisher re-reads database switches before every post, and checked-in development, staging, and production configuration keeps the deployment-level gate off.

## Logging

Structured logger fields matching authorization, cookies, secrets, tokens, payload/body content, messages, phone/contact information, subjects, and deletion receipts are replaced with `[REDACTED]`. Upstream error bodies are not copied into logs or API responses. Customer message bodies must remain in the private database only when operationally required. Provider request logs need separate URL redaction, especially private deletion status links.

## Privacy operations

Public deletion requests are unverified intake, never authorization to erase data. Signed Meta callbacks authenticate the app-scoped identifier, but Page/Messenger mappings still require verification. Only active owners with MFA can inspect requests or submit customer deletion. Deletion and completion are atomic; private tables/functions are service-role only. Daily keyed IP hashes rate-limit public form submissions without persisting raw IP addresses.

The scheduled Worker runs privacy retention independently of publication. See [Privacy and Meta review](PRIVACY_AND_META_REVIEW.md) for exact limits, restore/replay handling, staff offboarding, rights requests, and outstanding deployment controls.

## Remaining security work

- Add Cloudflare edge rate limiting for internal routes.
- Configure provider retention, backup deletion replay, and privacy-operation alerts.
- Add audit writes for every sensitive operation.
- Document incident response, secret rotation, and rollback.
- Review current Meta permissions and policies immediately before deployment.
