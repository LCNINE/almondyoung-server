# Demo stage implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute continuously within the user's implementation/deployment authorization.

**Goal:** Deploy an isolated SST demo environment with a working logistics demo console and no real external business integrations.
**Architecture:** Preserve the platform/auth/services topology and existing order outbox→Kafka→Core fulfillment pipeline. Add stage-gated fixtures, mock external adapters, and an admin console.
**Tech Stack:** Node 22, Yarn, NestJS, Drizzle/Postgres, Kafka, Next.js, SST, AWS.
**Spec:** `docs/superpowers/specs/2026-09-16-demo-stage-design.md`

## Global constraints

- Stage is exactly `demo`; domain root is `almondyoung-next.com` without `dev.`.
- Preserve live/dev resource identities and behavior. Do not modify existing apex/www CloudFront aliases.
- Use APP_STAGE=demo, DEMO_CONSOLE_ENABLED=true, EXTERNAL_INTEGRATIONS_MODE=mock. Demo real integrations fail closed.
- Keep core/admin/auth/file/channel-adapter/analytics/notification; omit commerce, wallet, membership, UGC, search/OpenSearch/Redis.
- Keep authenticated authorization; no live data or secrets copied. No raw business-table mutation for ongoing warehouse operations.
- Persist deterministic run/item identities, replay and conflict behavior. Use existing typed publishers and transactional outbox.
- Focused behavioral tests before implementation; test existing regression surfaces and build affected services.

## Task 1 — Deployment profile and bootstrap registry

Files: deployments/lcnine stage profile and three stack infra/config files; deployments conventions; scripts/seeding registry and relaunch plumbing.
Produces: common demo profile and mock environment contract above, demo-owned storage and URLs; bootstrap selects active services.

- [ ] Write behavioral profile tests for demo/live/dev URLs, resource selection, destructive policy and unchanged defaults; demonstrate failure.
- [ ] Implement explicit demo profile and conditional resources/secrets without changing live resource names. Prefer separate demo setup entrypoint to keep legacy graph untouched when appropriate.
- [ ] Wire domain, cookies, issuer, outputs, active-service registry, stage-safe S3 permissions and minimal demo secrets.
- [ ] Verify tests, SST typecheck/preview availability, and document secret/bootstrap order. Commit only scoped files.

## Task 2 — Demo channel ingestion and outbound mocks

Files: apps/channel-adapter/src/demo/*, adapter.module.ts and outbound provider selection, schema/migrations if needed.
Consumes: environment contract; Core seeded product/variant identifiers.
Produces: authenticated demo endpoints under `/demo`: GET capabilities/data and run listing/detail; POST runs with `{requestId, scenario, count, variantId?, quantity?}`. Share exact response contracts with console owner before UI implementation.

- [ ] Add failing tests for stage gating, request validation, stable run/item identities and conflicting replay.
- [ ] Implement persisted run input and virtual provider using existing order collection/publisher path, with status/error/result lookup.
- [ ] Replace external channel/Medusa/member sync and dispatch in demo with persisted mock outcomes; prevent real cron/provider calls.
- [ ] Verify mock ingestion publishes schema-valid confirmed orders and output replay is stable. Run related channel tests/build, commit scoped files.

## Task 3 — Core mock carrier and logistics fixtures

Files: apps/core/src/modules/demo/*, carrier factory/providers, module wiring, migration if needed; scripts/seeding demo-logistics fixture and seed wiring.
Consumes: environment contract. Produces Core `/demo` fixture/catalog/readiness endpoints and deterministic sample variant identifiers; coordinate exact DTO with Task 2/4.

- [ ] Test and implement a persistent mock CarrierGateway supporting allocate/register/cancel/track and existing printable/scannable data.
- [ ] Add authenticated/stage-gated demo endpoints and fixtures for catalog/SKU/warehouses/locations/suppliers/mappings and history with deterministic IDs.
- [ ] Prepare historical demand/lead-time inputs and trigger existing full recomputation, while avoiding hundreds of stale open shipments.
- [ ] Test live exclusion, fixture idempotency, carrier replay and real warehouse invariants. Build core and report fixture entrypoint/IDs. Commit scoped files.

## Task 4 — Admin console, auth/notification boundaries and native build

Files: apps/admin-web/src/app demo page/API, feature/menu/capability guards; apps/notification mock provider; apps/user-service demo integration guards; native/warehouse-app demo config; seed auth client/account logic.
Consumes: Task 2/3 endpoint contracts. Produces authenticated console and demo-compatible login/native artifacts.

- [ ] Add failing tests for disabled demo APIs and excluded-service proxy access.
- [ ] Implement `/demo` console with fixture readiness, run generation/status/retry and links; persistent banner and capability menu filtering.
- [ ] Mock notification sends with persisted success/history and block auth external business APIs in demo; provision demo OAuth clients and operator scopes through existing seed contracts.
- [ ] Add demo native build configuration with isolated application identity/storage and matching OAuth callback registration.
- [ ] Verify admin/native builds and server guards; capture UI screenshot where browser tooling permits.

## Task 5 — Integration review and deploy

Files: deployment/bootstrap runner, demo runbook, acceptance report.

- [ ] Cross-review implementations for external side effects, absent-service references, stage isolation, transactional ingestion and data completeness; repair findings.
- [ ] Run DB+Kafka integration on dedicated local resources, focused affected suites and builds.
- [ ] Provision only demo secrets, deploy platform→auth→services with required DB bootstrap/migrations before healthy activation.
- [ ] Seed demo data and accounts, exercise authenticated deployed order creation→FO→waybill and warehouse operations; record exact outcomes.
- [ ] Publish URLs and artifact paths, document any external blocker or physical-device-only acceptance without claiming unperformed checks.

## Interface/preflight ledger

Task 1 owns infra/registry; Task 2 owns channel-adapter; Task 3 owns core/logistics seed; Task 4 owns admin/notification/auth/native. Seed orchestrator changes belong Task 3, auth seed work will be sequenced to avoid conflicts. Root owns final review, deployment and cross-service integration. No worker deploys AWS resources.
