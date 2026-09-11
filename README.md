# MobDeals Meta Automation Suite

Standalone Facebook Page automation for MobDeals Kenya, built for Cloudflare Workers, Supabase, and the Meta Graph API. It includes a staff-only operations dashboard but no customer website, custom Meta inbox, Render service, n8n dependency, payment flow, or AI-generated replies.

## Current build status

The project is being implemented in the phases defined by the source specification.

- Phase 1 — foundation: implemented
- Phase 2 — webhook ingress foundation: implemented
- Phase 3 — scheduled publishing: implemented locally with outbound-safe defaults
- Phase 4 — comment automation: not yet implemented
- Phase 5 — Messenger automation: not yet implemented
- Phase 6 — production hardening and complete operations documentation: in progress

The current Worker provides:

- `GET /health`
- `GET /webhooks/meta` verification
- `POST /webhooks/meta` raw-body HMAC-SHA256 verification
- strict Zod payload validation
- 256 KiB ingress limit
- durable, idempotent Supabase webhook ingestion
- optional Cloudflare Queue dispatch with a database-backed fallback
- a five-minute scheduled publisher with fresh-read kill switches, daily limits, publication-attempt idempotency, bounded retry, and text/single-image Meta clients
- structured logs with sensitive-field redaction
- a normalized release-one schema, RLS, indexes, and seed data
- a responsive staff dashboard with Supabase Auth, role-aware read APIs, post drafting/approval, guarded automation controls, failures, audit history, and team access
- public privacy/terms/deletion pages, a signed Meta deletion callback, an owner/MFA deletion review queue, and scheduled retention cleanup

Outbound posting and replies remain disabled in every checked-in environment. The publisher is covered by mocks, but the repository has not been deployed and no real Meta or Supabase API operation is claimed.

## Local setup

Requirements: Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .dev.vars
npm run check
npm test
npm run dev
```

Use placeholder values locally. Do not commit `.dev.vars`, service-role keys, app secrets, or Page tokens.

## Database setup

Apply migrations in filename order, then apply the seed data:

1. `migrations/0001_initial_schema.sql`
2. `migrations/0002_product_images_bucket.sql`
3. `migrations/0003_dashboard_staff_access.sql`
4. `migrations/0004_scheduled_publishing.sql`
5. `migrations/20260909222541_privacy_deletion_retention.sql`
6. `seeds/0001_initial_data.sql`

The seed is safe by default: every outbound switch is off, maintenance mode is on, and the example product is inactive and out of stock.

## Commands

- `npm run check` — strict TypeScript validation
- `npm test` — mocked Vitest suite; no real credentials required
- `npm run build` — Cloudflare Worker dry-run build
- `npm run dev` — local Wrangler development server
- `npm run dev:dashboard` — Vite dashboard development server; use `/?demo=1` for the local mock preview
- `npm run deploy:staging` — deploy the staging environment
- `npm run deploy:production` — deploy the production environment

Deployment commands require manual Cloudflare and secret configuration first. `OUTBOUND_ACTIONS_ENABLED` remains `false` in every checked-in Wrangler environment.

Wrangler uses distinct Worker names for each environment: `ecomautomationworks-development` for the default configuration, `ecomautomationworks-staging` for staging, and `ecomautomationworks` for production. Production serves `meta.ecomautomationworks.com` with its `workers.dev` route disabled. Use `npm run deploy:production` to select the production configuration explicitly.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Containers and GHCR](docs/CONTAINERS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Scheduled publishing](docs/SCHEDULED_PUBLISHING.md)
- [Security](docs/SECURITY.md)
- [Staff dashboard](docs/DASHBOARD.md)
- [Privacy, data deletion, and Meta readiness](docs/PRIVACY_AND_META_REVIEW.md)

The public policy identity is configured as MobDeals Online Store, `mobdealskenya@gmail.com`, 00100 Nairobi. Environments missing `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTACT_EMAIL`, or `PRIVACY_POSTAL_ADDRESS` return a clearly labeled draft with HTTP 503. Review the privacy readiness document for database setup, exact Meta app URLs, owner verification, and remaining operational requirements.

The original 27-page specification remains in the repository as `MobDeals Kenya Facebook Automation Service (1).pdf`.
