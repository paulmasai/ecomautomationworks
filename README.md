# MobDeals Meta Automation Suite

Standalone Facebook Page automation for MobDeals Kenya, built for Cloudflare Workers, Supabase, and the Meta Graph API. It has no website, custom inbox, Render service, n8n dependency, payment flow, or AI-generated replies.

## Current build status

The project is being implemented in the phases defined by the source specification.

- Phase 1 — foundation: implemented
- Phase 2 — webhook ingress foundation: implemented
- Phase 3 — scheduled publishing: not yet implemented
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
- structured logs with sensitive-field redaction
- a normalized release-one schema, RLS, indexes, and seed data

Outbound posting and replies are deliberately disabled. The repository has not been deployed and no real Meta or Supabase API operation is claimed.

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
3. `seeds/0001_initial_data.sql`

The seed is safe by default: every outbound switch is off, maintenance mode is on, and the example product is inactive and out of stock.

## Commands

- `npm run check` — strict TypeScript validation
- `npm test` — mocked Vitest suite; no real credentials required
- `npm run build` — Cloudflare Worker dry-run build
- `npm run dev` — local Wrangler development server
- `npm run deploy:staging` — deploy the staging environment
- `npm run deploy:production` — deploy the production environment

Deployment commands require manual Cloudflare and secret configuration first. `OUTBOUND_ACTIONS_ENABLED` remains `false` in every checked-in Wrangler environment.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Containers and GHCR](docs/CONTAINERS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Security](docs/SECURITY.md)

The original 27-page specification remains in the repository as `MobDeals Kenya Facebook Automation Service (1).pdf`.
