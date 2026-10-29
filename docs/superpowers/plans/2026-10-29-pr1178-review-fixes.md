# PR #1178 review fixes

> **For agentic workers:** Use `executing-plans` to implement these tasks inline.

**Goal:** Resolve the CI type errors and the two verified internal review findings.

**Architecture:** Reuse model selection comparison and transactional product outbox publication for SKU remapping.
Acquire product locks before variant locks, matching publication order.
Use the existing next-intl product detail messages for viewer text.

**Tech Stack:** NestJS, Drizzle, PostgreSQL, Jest, React, next-intl, Vitest.

**Spec:** `docs/inventory/sku-3d-models.md` and the PR #1178 internal review.

## Constraints

- Run one test runner at a time, with Jest `--runInBand`.
- Keep existing snapshots and thumbnails unchanged except for selected model changes.
- Keep SKU mapping changes and their product outbox event in one transaction.
- Preserve readable semantic spacing and format changed files.

## Tasks

- [x] Fix `MedusaProductPayload.metadata` and the two CI test typing errors.
      Verify the full root TypeScript gate with Node 22.
- [x] Add English/Japanese viewer regression cases, observe failure, and translate the viewer in ko/en/ja.
      Verify both viewer test files.
- [x] Extract shared model selection capture/publication into a product service.
      Call it before/after mapping replacement or clearing, with product locks acquired first.
      Add PostgreSQL cases for model replacement, clearing, rollback, and concurrent review.
      Verify manager, mapping, and integration tests serially.
- [x] Repeat the internal Codex whole-PR review until there are no actionable findings.
      Verify types, focused tests, formatting, and PR checks before delivery.

## Review focus

- Mapping a live variant from approved SKU A to approved SKU B must publish B.
- Clearing links must publish a model removal or fall back to the next eligible option.
- An outbox failure must roll back mapping changes.
- Model review and remapping must serialize without stale snapshots or deadlocks.
- Locale changes must preserve viewer loading, error, and cleanup behavior.

## Execution record

- Baseline: 11 root suites (203 tests), PostgreSQL integration (19), viewer (13), Medusa metadata (1) passed.
- CI confirmed four type errors.
  The initial local full type gate exhausted Node's default heap; rerun uses a 4096 MiB heap.
- Internal review found SKU remapping projection drift and untranslated viewer strings.
- Full root TypeScript gate passed after the CI fixes.
- English/Japanese regressions failed before translation and passed afterward (viewer: 15 tests).
- PostgreSQL regressions reproduced missing remapping, removal, rollback, first-match, and void-strategy events.
  The previously unlinked SKU approval race also failed without the new SKU lock.
- Ruling: cover all matching link mutation paths, including automatic and legacy matching.
  The same stale model failure otherwise remains reachable through those APIs.
- Focused root verification: 17 suites, 276 tests passed, including 26 PostgreSQL cases.
- Merged current `develop` and reconciled migration journal order and the combined snapshot.
  Drizzle generation reported no schema changes, and the merged full TypeScript gate passed.
- Rejected the lane-order finding after tracing the existing lifecycle supersession check.
  It checks newer pending, processing, published, and failed events before invoking product sync.
  Existing inbox worker and consumer verification passed 33 tests.
- Reproduced the default suite's Docker dependency with Docker stopped.
  PostgreSQL model integration now requires `REQUIRE_SKU_3D_MODELS_DB=1`.
- Verified the opt-in with Docker stopped (26 skipped) and enabled (26 passed).
- Final internal whole-PR review reported no remaining actionable correctness regressions.
  The PR is mergeable, and GitHub verification is rerunning on the published fixes.
