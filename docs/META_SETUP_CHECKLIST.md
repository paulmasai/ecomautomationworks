# MobDeals Meta setup checklist

Checked on 15–16 September 2026. Scope: the operator's MobDeals Facebook Page only. `.dev.vars` is the local source of truth. No credentials are included here.

## Verified status

| Item | Finding |
| --- | --- |
| Local credentials | Supabase service-role and publishable keys both authenticated successfully. Meta accepted the App ID/App Secret and returned the app name **Mobdeals online**. |
| Local API version | Changed `META_GRAPH_API_VERSION` from `vXX.X` to `v26.0`, which Meta accepted in read-only requests. |
| Page token | The configured value is a valid **user** token for the correct app, not a Page token. It has `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`, but lacks `pages_manage_metadata`; `/me/accounts` returned no Pages and the configured Page ID could not be read. Do not deploy it as `META_PAGE_ACCESS_TOKEN`. |
| Supabase platform access | At 00:42 EAT on 16 September, the official status API still reported a partially degraded service and the maintenance as `verifying`. The CLI could list the target project as `ACTIVE_HEALTHY`, but a linked SQL inspection did not complete. The configured project's REST gateway, Auth, and Storage endpoints had returned HTTP 200, so the project runtime remained reachable while management work was deferred. |
| Local verification/admin secrets | Present; neither matches the checked-in template. Keep the existing values. |
| Outbound actions | Local setting and deployed Worker setting are both `false`. Database switches could not be read. |
| Public pages | `/`, `/privacy-policy`, `/terms`, and `/data-deletion` returned HTTP 200. This checks page availability, not submission processing. |
| Deployed backend | `/health` and `/webhooks/meta` returned HTTP 500 with `service_unavailable`. |
| Cloudflare bindings | The active Worker version has no application secrets and runs with `ENVIRONMENT=development`, despite serving the production domain. Later, undeployed dashboard drafts added `Meta_app_Id`, `Supabase_Service_role`, and `Supabase_publishable_key`; these do not match the code. Wrangler OAuth was restored. The checked-in production config now declares every required binding name so a future deploy fails rather than silently omitting one; the live correction still requires valid Page credentials. |
| Supabase schema | Required application tables/functions are absent from the service-role REST schema. Reads of `automation_settings`, `staff_profiles`, and `facebook_pages` returned `PGRST205`. Confirm schema/grants/cache in SQL before deciding which migrations are missing. |
| Product storage | `product-images` returned `NoSuchBucket`. |
| Staff authentication | Email authentication is enabled, but public signup is also enabled (`disable_signup=false`). |
| Meta webhooks | The app's `/subscriptions` response is empty. No app-level callback subscription is configured. |
| Meta business/review status | Operator reports setup complete. Live mode, business verification, use-case selection, and individual permission access levels were not independently verified. |
| Local validation | Runtime configuration validation, TypeScript checks, all 69 tests, and the dashboard/Worker dry-run build passed. Configuration validation alone does not reject the Page-token placeholder. |

## What the owner needs to do

### 1. Generate the MobDeals Page token

Open [Graph API Explorer](https://developers.facebook.com/tools/explorer/) and select **Mobdeals online**, matching `META_APP_ID`. Use the Facebook account that has access to both the app and the MobDeals Page, with the Page tasks needed to publish and manage its subscriptions.

Check these permissions for the current release:

| Permission | Purpose |
| --- | --- |
| `pages_show_list` | Find the Pages the authorizing account manages and obtain the correct Page token. |
| `pages_read_engagement` | Read the Page content/metadata required by the Pages API. |
| `pages_manage_posts` | Publish approved text and single-image Page posts. |
| `pages_manage_metadata` | Subscribe the Page to the app's webhooks. |

Generate/authorize the user token with these permissions, confirm the MobDeals Page appears under `/me/accounts`, then select **Get Page Access Token** and the MobDeals Page. Ensure the final token comes from this app and this Page. The current token returns no managed Pages, so first correct the Page task/business asset assignment or use the Facebook account that actually manages the Page. For ongoing operation, obtain a long-lived Page token through Meta's supported token flow; a temporary Explorer token is only suitable for initial checks.

Replace only `META_PAGE_ACCESS_TOKEN` in `.dev.vars`. Keep the token out of chat and Git. I can then inspect its app, Page, permissions, expiry, and data-access expiry before deployment. Token longevity is not a guarantee against revocation.

For this own-Page deployment, use the access available to the app/asset roles and complete any Advanced Access or App Review requirements displayed for the actual permissions. Business verification and permission approval are separate. Do not assume owning the Page grants access to every customer's data.

### 2. Confirm the Meta app settings

Use the following values in the applicable Basic Settings/use-case screens. Menu names vary between app types.

| Setting | Value/action |
| --- | --- |
| App | **Mobdeals online**, matching the local App ID. |
| App contact | An actively monitored operator address; the configured public privacy contact is `mobdealskenya@gmail.com`. |
| App domain | `meta.ecomautomationworks.com`; include parent `ecomautomationworks.com` if required by the dashboard's domain validation. No scheme or path in a domain field. |
| Website URL, if a website platform is requested | `https://meta.ecomautomationworks.com/` |
| Privacy Policy URL | `https://meta.ecomautomationworks.com/privacy-policy` |
| Terms URL | `https://meta.ecomautomationworks.com/terms` |
| Data deletion instructions | `https://meta.ecomautomationworks.com/data-deletion` |
| Data deletion callback, if choosing the callback option | `https://meta.ecomautomationworks.com/webhooks/meta/data-deletion` — activate/test after the backend and database are ready. |
| Icon/category/business ownership | Complete the dashboard's required fields; confirm the Page and token issuer have the correct business asset assignments. |
| Mode/access | Confirm the dashboard's required permissions/access levels and production/Live requirements before receiving real customer events. |

The service uses Supabase staff login and a deployment-level Page token. It has no customer Facebook Login/OAuth flow or deauthorization endpoint. The webhook is not an OAuth redirect URL.

### 3. Finish the webhook setup after the backend is healthy

| Setting | Value |
| --- | --- |
| Webhook object | **Page** |
| Callback URL | `https://meta.ecomautomationworks.com/webhooks/meta` |
| Verify token | The exact existing `META_VERIFY_TOKEN` from `.dev.vars`, also installed on the Worker. It is not the App Secret or Page access token. |
| API version | `v26.0` |
| Initial field | `feed`, for Page event ingestion. |

Save/verify the callback in Meta only after it returns the requested challenge successfully. I can perform the separate Page installation through `/{PAGE_ID}/subscribed_apps` using the Page token, preserving any existing fields, and check it afterward. Configuring the app callback alone does not subscribe the Page.

Comment and Messenger reply automation are not implemented in this release. Keep both reply switches off. When those features are implemented, revisit `pages_read_user_content`, `pages_manage_engagement`, and `pages_messaging`, and the required Messenger event fields such as `messages` and `messaging_postbacks`. Do not request review for unimplemented functionality. Messenger sending also has messaging-window restrictions; see [Meta's Messenger API collection](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api).

### 4. Complete staff authentication settings in Supabase

- Disable public signup; staff access is invite-only.
- Keep email/password enabled and enable TOTP MFA. Owners must enroll MFA before approvals and other privileged actions.
- Set Site URL to `https://meta.ecomautomationworks.com`.
- Allow the redirect `https://meta.ecomautomationworks.com/settings`; add `http://localhost:5173/settings` only for local development.
- Configure production email delivery for invitations/password resets. Create the first owner's Auth account; provide the intended owner email so its staff profile can be created after database setup.

## Technical work I can handle

1. **Database setup:** inspect actual SQL objects and migration history, then apply missing migrations in order: `0001_initial_schema.sql`, `0002_product_images_bucket.sql`, `0003_dashboard_staff_access.sql`, `0004_scheduled_publishing.sql`, and `20260909222541_privacy_deletion_retention.sql`. Apply the seed for a fresh setup; review it before running against existing data because it updates automation settings. Verify REST grants/RLS, publishing/privacy RPCs, and the product bucket. Management access was unavailable during Supabase's scheduled maintenance; service-role REST credentials authenticate but do not provide arbitrary SQL execution. SQL work needs access through an authorized Supabase connection, database connection, or the owner's SQL Editor after the maintenance ends.
2. **Staff/Page records:** create the first active owner profile and the matching active MobDeals `facebook_pages` record after confirming the owner and Page identity.
3. **Cloudflare bindings:** install the exact case-sensitive keys listed below using `.dev.vars`, after the valid Page token is supplied. Use the production configuration rather than copying the local `ENVIRONMENT=development` setting. The local production configuration now declares these keys as required. Wrangler is authenticated. Because undeployed dashboard drafts prevent the legacy bulk-secret API from updating the Worker, upload the verified secrets atomically with the production code (`wrangler deploy --env production --secrets-file ...`) rather than deploying those stale drafts. Remove the old incorrectly named bindings only after the replacement deployment is verified.
4. **Deployment:** build and deploy the production Worker `ecomautomationworks` on the existing domain, with outbound actions still disabled. Local `.dev.vars` does not automatically update deployed Worker bindings.
5. **Verification:** check health, staff login/MFA, policy URLs, deletion request persistence, signed webhook verification and ingestion, duplicate handling, Cron, and the app/Page subscriptions.
6. **Controlled publishing:** prepare one approved test post and review its content/Page before sending. Verify the returned Meta post ID, ledger, limits, and kill switches before wider operation. No posts or customer messages were sent during this audit.

Required Worker keys, spelled exactly:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEY
META_APP_ID
META_APP_SECRET
META_PAGE_ID
META_PAGE_ACCESS_TOKEN
META_VERIFY_TOKEN
META_GRAPH_API_VERSION
INTERNAL_ADMIN_SECRET
```

Use encrypted Worker secrets for service-role credentials, App Secret, Page token, verification token, and admin secret. The production configuration must also supply:

```dotenv
ENVIRONMENT=production
LOG_LEVEL=info
OUTBOUND_ACTIONS_ENABLED=false
PRIVACY_CONTROLLER_NAME="MobDeals Online Store"
PRIVACY_CONTACT_EMAIL=mobdealskenya@gmail.com
PRIVACY_POSTAL_ADDRESS="00100 Nairobi"
```

The privacy values already exist in `wrangler.toml`; they are not missing merely because `.dev.vars` omits them. Initially keep database `global_automation_enabled=false`, `posting_enabled=false`, `comment_replies_enabled=false`, `messenger_replies_enabled=false`, and `maintenance_mode=true`.

## Verification limits

Meta app identity, API version, token type/scopes/expiry, Page visibility, subscription state, Cloudflare binding names, public URLs, Supabase data-plane responses, the Supabase status API, and Supabase CLI project access were checked directly. Meta's detailed Pages/permissions documentation returned rate-limit or fetch errors, so confirm the suggested permission set and access requirements in the authenticated app dashboard before submission. Reference destinations: [Pages publishing](https://developers.facebook.com/docs/pages-api/posts/), [Page webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages/), and [permissions](https://developers.facebook.com/docs/permissions/).

No remote configuration, database data, subscriptions, deployment, or outbound switches were changed during this follow-up. The production Wrangler configuration was hardened to require the exact runtime binding names.
