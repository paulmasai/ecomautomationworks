# Implementation plan

This plan follows the order required by the source specification. A phase is complete only after its code, tests, and relevant documentation are checked in.

## Phase 1 — foundation

Status: implemented locally, not deployed.

- [x] Independent Worker project
- [x] Strict TypeScript and Worker runtime types
- [x] Wrangler environments with outbound-safe defaults
- [x] Zod environment validation
- [x] Minimal Supabase REST/RPC client
- [x] Structured redacted logging
- [x] Complete initial application schema
- [x] RLS, grants, constraints, indexes, and updated-at triggers
- [x] Safe settings/templates/example seed
- [x] Product image bucket migration

## Phase 2 — webhook foundation

Status: ingress implemented locally; async domain consumers belong to phases 4 and 5.

- [x] Meta verification endpoint
- [x] Raw request signature verification
- [x] Strict Page webhook envelope validation
- [x] Durable raw event storage
- [x] Atomic duplicate protection
- [x] Optional Queue dispatch and database fallback
- [x] Tests for verification, signature, malformed input, duplicate delivery, and fallback
- [ ] Comment/Messenger normalization consumers

## Phase 3 — scheduled publishing

Status: not started. The atomic claim function and supporting tables exist.

- [ ] Automation-settings repository and cache policy
- [ ] Due-post Cron handler
- [ ] Text and single-image Meta publishers
- [ ] Image accessibility/MIME/size validation
- [ ] Daily post limit
- [ ] Publication attempt ledger and duplicate tests
- [ ] Error classification and bounded retry
- [ ] Protected manual publish/cancel/retry operations

## Phase 4 — comment automation

Status: not started. Tables and safe seed templates exist.

- [ ] Normalize and idempotently store comment changes
- [ ] Match Meta posts to products
- [ ] Conservative deterministic intent detector
- [ ] Template variable validation/rendering
- [ ] Reply limits and idempotency keys
- [ ] Page-self/recursive reply suppression
- [ ] Complaint/sensitive-topic handoff
- [ ] Mocked Meta reply tests

## Phase 5 — Messenger automation

Status: not started. Tables and states exist.

- [ ] Normalize contacts, conversations, and messages
- [ ] Guided sales-state flow
- [ ] Rule-based product matcher
- [ ] Lead capture with voluntary phone handling
- [ ] Reply-window and reply-count controls
- [ ] Human handoff and automation stop
- [ ] Mocked Meta message tests

## Phase 6 — production hardening

Status: partially started.

- [x] Structured log redaction baseline
- [x] Audit/failure schema
- [x] Global outbound-safe environment switch
- [ ] Authenticated internal endpoints and rate limiting
- [ ] Audit writes for all required actions
- [ ] Retention, deletion, and anonymization operations
- [ ] Complete Meta/Supabase/Cloudflare setup guides
- [ ] Deployment, operations, incident response, and rollback guides
- [ ] End-to-end dry-run build and staging smoke tests

## Staff operations dashboard

Status: functional vertical slice implemented locally; live deployment and platform setup remain manual.

- [x] Responsive same-origin Worker SPA with safe local preview data
- [x] Supabase Auth login, password recovery, TOTP enrollment/challenge, staff profiles, and role permissions
- [x] Read-only overview, catalogue, posts, failures, audit, and team APIs
- [x] Post drafting and MFA-protected approval
- [x] Guarded automation switches, retry requests, invitations, and access changes
- [ ] Manual publish action after the Phase 3 publisher exists
- [ ] Comment and Messenger statistics after Phases 4 and 5 normalize events
- [ ] Staging Auth email, redirect, MFA, bootstrap, and role acceptance tests

## Release gates

- No outbound action is enabled until its mocked tests pass.
- Staging must remain outbound-safe until a human explicitly enables a controlled test.
- Production deployment requires real platform configuration and cannot be inferred from local tests.
- Meta API success, permissions, token validity, App Review, and deployment success must never be fabricated.
