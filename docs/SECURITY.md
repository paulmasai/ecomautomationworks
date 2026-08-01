# Security baseline

## Secrets

The following values must be Cloudflare Worker secrets and must never be committed: `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN`, and `INTERNAL_ADMIN_SECRET`.

The `.env.example` file contains placeholders only. Local values belong in the ignored `.dev.vars` file.

## Why the Worker uses the service-role credential

There is no browser client and no public Supabase API surface in this architecture. The Worker performs trusted server-side inserts, atomic RPC calls, and automation updates. Its service-role key bypasses RLS by design, so compromise would grant broad database access. The key is therefore restricted to Cloudflare secrets, never returned by a route, and never written to logs. Rotation is required after suspected exposure.

## Webhook trust model

Webhook input remains untrusted even when it is transported over HTTPS. The Worker:

1. Caps the raw body size.
2. Verifies `X-Hub-Signature-256` against the exact bytes using the app secret.
3. Rejects unsigned or incorrectly signed bodies before JSON parsing.
4. Validates the parsed shape with Zod.
5. Uses a delivery fingerprint and database uniqueness constraint for replay safety.
6. Logs only identifiers and result metadata, never the payload.

## Database access

RLS is enabled for all application tables. No anon/authenticated table or function access is granted. Supabase Studio administration occurs through trusted project accounts. The public product image bucket permits reads required by Meta but does not include public upload, update, or delete policies.

## Outbound safety

Database settings independently control global, posting, comment, and Messenger automation. `OUTBOUND_ACTIONS_ENABLED` is a second deployment-level gate. Both must allow an action before a future publisher/replier may call Meta. Checked-in development, staging, and production configuration keeps the deployment-level gate off.

## Logging

Structured logger fields matching authorization, cookies, secrets, tokens, payload/body content, messages, or phone information are replaced with `[REDACTED]`. Upstream error bodies are not copied into logs or API responses. Customer message bodies must remain in the private database only when operationally required.

## Remaining security work

- Add authenticated internal operations routes with constant-time bearer validation.
- Add Cloudflare edge rate limiting for internal routes.
- Implement data retention, deletion, and anonymization jobs.
- Add audit writes for every sensitive operation.
- Document incident response, secret rotation, and rollback.
- Review current Meta permissions and policies immediately before deployment.
