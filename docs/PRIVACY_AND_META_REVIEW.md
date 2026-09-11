# Privacy, deletion, and Meta app readiness

Reviewed 10–11 September 2026 against the repository. **Implementation is prepared locally; this is not a GDPR compliance certification or evidence of Meta app approval.** The operator confirmed the controller as **MobDeals Online Store**, privacy contact **mobdealskenya@gmail.com**, postal address **00100 Nairobi**. These public values are configured in the checked-in Worker environments and `.env.example`. Existing local deployment configuration names `meta.ecomautomationworks.com`; document any separate processor relationship with Ecom Automation Works if applicable.

## Public URLs

After deployment and configuration, use:

| Meta app field / purpose | URL |
| --- | --- |
| Privacy Policy URL | `https://meta.ecomautomationworks.com/privacy-policy` |
| Terms of Service URL | `https://meta.ecomautomationworks.com/terms` |
| User Data Deletion instructions | `https://meta.ecomautomationworks.com/data-deletion` |
| Data Deletion Request Callback URL | `https://meta.ecomautomationworks.com/webhooks/meta/data-deletion` |

Choose the callback or instructions option offered by your actual Meta app dashboard. The existing Page event subscription remains `/webhooks/meta`; it is a different endpoint. Policy links appear on staff sign-in and in the dashboard. Public notices are server-rendered HTML and do not require JavaScript, authentication, or a working database. Worker asset routing explicitly bypasses the staff SPA for these paths.

The confirmed public identity is set through `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTACT_EMAIL`, and `PRIVACY_POSTAL_ADDRESS` in each checked-in Worker environment. Ensure deployment overrides retain those values. If any are missing or invalid, policy pages display a draft notice and return **503** so an incomplete notice is not presented as publication-ready. Configuration alone does not settle the legal questions below. Database and Meta secrets are still required for request processing.

## What was found and changed

| Finding | Repository change / remaining action |
| --- | --- |
| No privacy, terms, or deletion instructions | Added public pages describing the actual service, sources, categories, purposes, proposed lawful bases, providers, retention, rights, browser storage, and limitations. Confirm factual/legal content before publication. |
| No Meta deletion callback | Added form-encoded `signed_request` verification using the app-secret HMAC-SHA256, strict base64url/claim validation, an 8 KiB streaming limit, and the `url` / `confirmation_code` response. Persistence errors return 503, never false success. |
| App-scoped versus Page-scoped identity mismatch | Signed requests enter a pending review queue. Owner must verify the identity mapping; an app-scoped user ID is never assumed to be the Messenger PSID. |
| No customer request channel | Public form records email and a short reference; no login or policy acceptance is required. Same-origin validation and a database-backed five-submissions-per-hour limit use a daily keyed IP hash that expires after one day. Provider-level rate limiting is still needed for volume protection. |
| No complete erasure operation | Owner + MFA action deletes verified customer records in one transaction, clears request details, and writes a minimal audit receipt. SQL validates active owner and prevents use of a Page ID. |
| Webhook retries could recreate data | Restricted identifier hashes suppress matching deliveries for 90 days. Suppressed raw payloads are cleared, marked ignored, and never enqueued. Ingress and erasure share a transaction lock. |
| Retention settings existed only as recommendations | Scheduled cleanup now enforces fixed upper limits independent of outbound switches. Log overdue privacy requests for operator follow-up. |
| Secrets were redacted, but privacy field names were not covered | Expanded logger redaction to contact, subject, receipt, signed-request, and related identifiers. Upstream error bodies stay out of API responses. |
| Staff and infrastructure data need separate handling | Staff offboarding, provider logs/backups, Meta originals, exports, and external support records require the operational procedure below. |

## Database setup and validation

Apply `migrations/20260909222541_privacy_deletion_retention.sql` after migrations `0001`–`0004`, before deploying the new Worker. It adds private requests, suppression hashes, and rate buckets, with RLS and explicit revocation from `PUBLIC`, `anon`, and `authenticated`. New functions are `SECURITY INVOKER`, have an empty search path, and are granted to `service_role` only. It also updates webhook ingestion to return whether a delivery was ignored. Do not expose these tables directly to the browser.

The migration file was generated with `supabase migration new`, then moved into the repository's existing `migrations/` directory. This repository does not yet use a standard Supabase CLI project layout. Do not run an unreviewed remote database push.

Validation performed locally:

- TypeScript checks, Worker dry-run build, dashboard build, and mocked Worker/dashboard tests.
- Actual SQL execution with disposable PGlite Postgres, loading application migrations `0001`, `0003`, `0004`, and the new migration. The test bootstrap provides the Supabase roles and `auth.users`; the unavailable `pgcrypto` extension declaration is omitted there. Storage-only migration `0002` is not exercised by that harness.
- `tests/privacy-deletion.sql` exercises cascades, linked leads, exact JSON identifier matching, multi-person deliveries, independent users, retry idempotency, a forced late failure and transaction rollback, receipt minimization, suppression, RLS/grants, retention, and durable rate limiting.

Run the SQL fixture **only against a disposable database**, using `psql -v ON_ERROR_STOP=1 -f tests/privacy-deletion.sql` after migrations. Its fixture transactions roll back. Run the real migration in staging and verify service-role RPC calls and Supabase advisors before production. No production migration, deletion, or deployment was performed in this review.

## Deletion operation

1. The owner completes MFA and opens **Data deletion**. Pending requests are listed oldest first, up to 100 at a time; completion/refresh reveals the next requests.
2. Verify control through the customer's existing Page/Messenger channel. For a Meta callback, verify the association between the app-scoped ID and every stored Page/Messenger identifier using an authorized Meta mapping or existing verified correspondence. Do not infer identity from a matching name, an unverified email, or similar numeric IDs. Request only proportionate additional evidence; do not ask routinely for government ID.
3. Use Supabase Studio, with restricted administrator access, to locate the verified numeric identifiers in `messenger_contacts.meta_sender_id`, `facebook_comments.commenter_id`, and `leads.customer_identifier`. Follow contact/conversation relationships and inspect whether any additional identifiers or external copies exist. This dashboard intentionally does not let an anonymous requester choose records to erase.
4. Check records outside the automated scope: provider/Auth logs, exports, support mail, product assets, free-text mentions about the person in another customer's content, and Meta originals. Delete or restrict those as applicable and notify relevant recipients where required. Do not copy verification evidence or customer message text into `audit_logs`.
5. Enter all verified identifiers and the verification method. Type **DELETE VERIFIED DATA** and submit. This permanently removes the matching comments/replies, contacts/conversations/messages, leads (including leads linked through a conversation even when their identifier differs), full raw deliveries containing the identifiers, and linked failure/audit records. Removing an entire mixed raw delivery may also discard pending events for another person; this prioritizes preventing replay of the deleted data. The confirmation receipt updates only after the transaction succeeds.
6. Communicate the result through the verified channel. Explain the active-database scope, any external steps, the actual backup expiration date, and any lawful exception. A receipt with zero matching rows is not proof that all external records were searched. Repeating completion for the same request is safe.

For requests where identity cannot yet be established, records require restriction rather than erasure, or a lawful exception applies, keep the request pending, record the decision in the restricted external rights register, and respond within the applicable deadline. This release does not provide a refusal or legal-hold dashboard workflow. Do not click completion merely to clear the queue. Open requests are never silently expired by cleanup.

The callback acknowledges receipt and starts the process; it does **not** claim instant deletion. Receipts use 256-bit capabilities, with hashes stored in the database; Meta retries derive the same receipt using a separate HMAC domain. Public status reveals only pending/completed and dates. Request contact/reference and Meta identifiers are cleared on completion; no verification documents are stored. Anyone holding a status URL can read its limited status, so exclude those URLs from analytics and redact them in provider request logs.

## Retention and restoration

| Data | Enforced application limit |
| --- | --- |
| Raw webhook events | 30 days from receipt, including unprocessed/failed events |
| Comments and cascaded replies | 90 days from comment creation |
| Messenger messages | 90 days from creation |
| Inactive contacts and conversations | 90 days since the latest contact/conversation creation, customer interaction, or message |
| Leads | 90 days from creation |
| Audit and failure logs | 30 days from creation |
| Completed deletion receipts | 90 days from completion |
| Identifier suppression hashes | 90 days from verified deletion |
| Form rate buckets | One day since the request window started |

These are fixed SQL limits; the old seed values `log_retention_days` and `message_retention_days` do not override them. Align policy copy and SQL in the same change if the approved schedule changes. Cleanup runs on the existing five-minute cron independently from publication success and the outbound kill switch. Alert on `privacy.retention_failed` and `privacy.requests_overdue`; somebody must monitor them and the pending queue daily. Large datasets need staged performance testing and bounded batch cleanup before scaling.

Configure and document Supabase backup/PITR retention, Auth audit retention, Cloudflare logs, and any exports. The repository cannot establish those account settings. Backups must remain beyond operational use after an erasure; on restoration, replay the restricted external deletion register before exposing the system or enabling workers. Keep that register only for the actual backup/recipient obligation, restrict access, and document its own retention. A 90-day suppression hash does not solve restoration from a backup that predates the deletion. Do not promise that backups are instantly erased.

Future comment/Messenger consumers must reacquire current database records, check suppression, and use the same transaction lock before materializing data; a stale Queue message is a reference, not permission to recreate or send customer data. No such consumers exist in this release. After 90 days, suppression expires, so new interactions may be processed again. Restore/import tooling must honor erasures independently of that window.

## Staff accounts and other GDPR rights

- **Staff erasure/offboarding:** verify the person; transfer ownership if necessary; suspend the staff profile first so Worker access checks fail immediately. Revoke sessions, remove unneeded Supabase Auth records using the supported admin interface, and confirm the profile cascades. Existing JWTs are not invalidated solely by deleting a user; validate suspension/deletion and session revocation in staging. Review staff UUIDs/emails in audit actors, settings `updated_by`, `assigned_staff_member`, and other free-text fields, then erase or lawfully minimize them. Review Auth/provider logs and backups separately. The customer deletion action accepts Meta numeric identifiers and does not delete staff accounts.
- **Access and portability:** verify identity, export the person's applicable data in a usable format, redact other people's data, and transfer it through a secure verified channel. Do not include access tokens, service credentials, or unrelated staff data.
- **Correction, restriction, objection, withdrawal:** maintain a rights register and respond through the privacy contact. Correct source and derived records, pause relevant processing while a restriction/objection is assessed, and propagate corrections/deletion to recipients where required. There is no consent-based marketing workflow in this release; adding one requires separate consent/withdrawal controls.
- **Incident response:** contain access, preserve necessary limited evidence, assess affected persons and risk, document the decision, and notify the competent authority within the applicable deadline (GDPR's 72-hour authority notification where required). Inform affected people when the legal risk threshold is met. Establish a named responder and processor escalation contacts.

## Required before claiming readiness

- Keep the confirmed controller and contact details current, monitor the privacy mailbox, and document whether Ecom Automation Works is a separate processor for MobDeals. If it serves additional customers, this single-Page schema needs tenant boundaries, per-customer contracts/notices, and deletion scoping before onboarding them.
- Determine GDPR territorial applicability and applicable Kenyan requirements; assess whether an EU representative or DPO is required. Add their real contacts if applicable. The operator must approve the proposed lawful bases, retention schedule, legitimate-interest balancing assessment, and the notice's accuracy.
- Complete the processing register, Article 28 processor terms where applicable, subprocessor inventory, actual hosting regions, international-transfer mechanism and transfer assessment. The current notice does not claim that specific contracts or SCCs have already been signed. Record any need for a DPIA.
- Confirm there is a lawful operational reason to receive each webhook field. Do not subscribe to unused personal-data fields simply for future feature development. Review the 30-day raw payload necessity; shorten it if troubleshooting does not need that period.
- Configure provider retention, backup restoration procedure, log redaction, incident contacts, and durable edge rate limits. The form limit supplements edge controls and can be shared by users behind the same public IP; email remains an alternative.
- Apply and test the migration in staging, configure the policy identity, deploy the Worker, confirm all public policy URLs return 200 over HTTPS without sign-in, and test a real Meta deletion callback with a test user. Test the posted form on the actual domain.
- In Meta's dashboard confirm app identity/contact, domains, business verification requirements, review/test-user access, current product-specific permissions and access levels, valid Page token ownership, webhook fields/signatures, applicable data-use reviews, and selected supported Graph API version. Explain only implemented features in the review recording. Comment and Messenger reply automation are not implemented and should not be represented as live features.
- If introducing Facebook Login or storing per-user tokens, add the appropriate deauthorization/permission-revocation handling and delete those tokens and mappings. The present service has a deployment-level Page token and staff Supabase login; do not claim user-token removal is implemented.

## Sources and verification limits

The legal review uses the [GDPR text on EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), especially transparency/rights, security, accountability, processor, and transfer obligations; [EDPB guidance on controller and processor roles](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en); and [EDPB international transfer guidance](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en). The [ICO erasure guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/) explains UK-specific handling including backups and is not treated as the EU supervisory authority.

Supabase's [database function guidance](https://supabase.com/docs/guides/database/functions) and [changelog](https://supabase.com/changelog) were checked; explicit function/table grants are included, including the newer behavior where new tables are not automatically exposed.

Meta's official [data deletion callback documentation](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/), [Platform Terms](https://developers.facebook.com/terms/), and [Developer Policies](https://developers.facebook.com/devpolicy/) were requested during this review, but Meta returned rate-limit/login/empty responses. The implemented callback follows the established signed-request and confirmation response contract and is covered by local tests. **Current Meta product-specific requirements and real app acceptance could not be independently verified here; verify them in the authenticated app dashboard before submission.** No Meta permission approval, live URL availability, provider contract, or production database configuration is asserted.
