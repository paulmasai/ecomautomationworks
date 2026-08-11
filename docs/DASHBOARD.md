# Staff automation dashboard

The dashboard is a same-origin React SPA served through the existing Cloudflare Worker static-assets deployment. It is an internal operations console, not a customer website or replacement for Meta Business Suite.

## Current capability

- Responsive overview with system/Page health, outbound state, approval and schedule counts, failures, handoffs, and recent audit activity.
- Invite-only Supabase Auth login and password recovery.
- Staff roles: owner, automation manager, content editor, support agent, and auditor.
- Read-only product, post, failure, audit, and team views.
- Post draft creation and MFA-protected approval.
- MFA-protected automation switches, failure retry requests, staff invitations, suspensions, and role changes.
- Development-only mock preview at `http://localhost:5173/?demo=1`.

Manual publication stays unavailable until Phase 3 supplies the Meta publisher. Comment and Messenger statistics stay unavailable until their normalized processors exist in Phases 4 and 5. Human replies continue in Meta Business Suite.

## Local setup

1. Install workspace dependencies with `npm ci`.
2. Apply `migrations/0003_dashboard_staff_access.sql` after the first two migrations.
3. Add `SUPABASE_PUBLISHABLE_KEY` to `.dev.vars`. This key is safe for browser authentication; the service-role credential remains Worker-only.
4. Run the Worker with `npm run dev`.
5. In another terminal, run `npm run dev:dashboard` for Vite hot reload.

The Vite development server proxies `/api` and `/health` to Wrangler on port 8787. Production builds place the SPA in `dashboard/dist`, which Wrangler publishes with the Worker.

## Supabase Auth setup

1. Enable email/password authentication and TOTP MFA.
2. Set the project Site URL to the deployed dashboard origin.
3. Add the deployed `/settings` URL and local `http://localhost:5173/settings` URL to allowed redirect URLs.
4. Create the first owner in Authentication > Users.
5. In the Supabase SQL editor, create the corresponding staff profile:

```sql
insert into public.staff_profiles (user_id, email, display_name, role, status)
select id, email, 'MobDeals Owner', 'owner', 'active'
from auth.users
where email = 'owner@example.com';
```

After the first owner signs in and enrolls MFA, additional staff are invited from Team & Access. The optional `POST /api/bootstrap` route can perform the one-time owner creation through a controlled CLI workflow using both a valid Supabase access token and `INTERNAL_ADMIN_SECRET`; it permanently rejects bootstrap after the first staff profile exists.

## Access model

| Role | Intended access |
| --- | --- |
| Owner | All dashboard data, team administration, approvals, automation controls, and retries |
| Automation manager | Operational data, approvals, automation controls, retries, and team visibility |
| Content editor | Products, posts, and post drafting; no approval or outbound controls |
| Support agent | Overview, products, failures, and human-handoff awareness |
| Auditor | Read-only overview, products, posts, failures, team, and audit history |

The browser authenticates with the Supabase publishable key and sends a short-lived access token to `/api/admin/*`. The Worker validates the token through Supabase Auth, loads the active staff profile, applies the role permission, and performs database work with the Worker-only service-role key. Application tables remain inaccessible to the browser `authenticated` role.

Privileged owner and automation-manager mutations require an `aal2` Supabase session. The API also applies a per-isolate request limit; production should additionally configure Cloudflare edge rate limiting for `/api/admin/*`.

## Safety behavior

- UI visibility never grants permission; every operation is authorized again in the Worker.
- Enabling the global automation database switch requires explicit confirmation and an audit record.
- `OUTBOUND_ACTIONS_ENABLED=false` remains the higher-priority environment kill switch.
- Raw webhook payloads, access tokens, secrets, message bodies, and phone numbers are never returned by dashboard endpoints.
- The console shows handoff summaries only and links staff to Meta Business Suite for the conversation itself.
