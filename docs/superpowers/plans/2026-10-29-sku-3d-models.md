# SKU 3D Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement issue #1164 from versioned SKU GLBs through transactional projection refresh to an opt-in storefront viewer.

**Architecture:** Store immutable generation versions and mutable review statuses beside SKU reference photos.
Select the latest approved model per SKU, then the first linked active variant by display order per product.
Reuse the product outbox and Medusa metadata to distribute the selected file ID.

**Tech Stack:** NestJS, Drizzle/PostgreSQL, Jest, Next.js/React, Vitest.

**Spec:** https://github.com/LCNINE/almondyoung-server/issues/1164 (local read-only copy: /tmp/issue-1164-spec.md).

## Global Constraints

- Preserve existing thumbnails and list screens.
- GLB MIME is `model/gltf-binary`; file context must be public and provisioned by a migration, not only a seed.
- Model statuses: `approved`, `needs_revision`, `needs_photos`, `failed`.
- New generation creates a new version; latest approved version is visible even when a newer version is unapproved.
- Publish only when a product's selected GLB changes, in the same database transaction.
- Batch approvals publish with origin `bulk_import`.
- Emit `model3dFileId: ""` to clear Medusa metadata.
- Focused Jest runners and Testcontainers run serially.
- Follow AGENTS.md semantic blank lines and sentence-per-line documentation.

## Review Focus

- Concurrent version creation/review must not lose versions or publish stale snapshots.
- Revoking approval must fall back to an older approved model or remove the metadata key.
- Earlier variants without approved models must not hide later eligible variants.
- Reject missing/private/incomplete/non-GLB uploads before approval.
- Viewer must not download models before explicit click and must release resources on close.

### Task 1: Core persistence, management, and product selection

**Files:** inventory.schema.ts; new inventory/sku-3d-models module; inventory.module.ts; products/loaders/product-model3d.loader.ts; projection-snapshot.assembler.ts and tests; core Drizzle migration and metadata.

**Interfaces:**

- Produces `sku3dModels` in inventory schema/wmsTables.
- Produces `ProductModel3dLoader.getFileId(tx, masterId, versionId): Promise<string | undefined>`.
- Produces optional `ProductSnapshot.model3dFileId` (contract changes belong to Task 2).
- Manager provides version list, registration, individual review, and batch review endpoints with existing inventory permissions.

- [x] Write failing tests for newest approved selection, variant ordering, revocation/fallback, transactional publication, no-op edits, concurrent version allocation, validation, and bulk origin.
- [x] Run focused Jest serially and record failure.
- [x] Implement schema/module/API and projection assembly using existing DB, file validation, publisher, and transaction patterns.
- [x] Generate only the additive core migration and confirm metadata consistency.
- [x] Run focused Jest serially, TypeScript checks, and self-review.

### Task 2: File context and Medusa contract

**Files:** default-file-contexts.ts and tests; file-service Drizzle data migration; event-contracts product snapshot schema; pim-to-medusa.transformer.ts and tests; Medusa metadata regression test.

**Interfaces:**

- Consumes optional `ProductSnapshot.model3dFileId`.
- Produces product metadata `model3dFileId: snapshot.model3dFileId ?? ''`.
- File context `sku-3d-model`, public only, 20 MiB hard limit; target model size at most 5 MiB.

- [x] Write and run failing tests for GLB context, present and absent model metadata, contract preservation, and actual installed Medusa metadata merge add/remove behavior.
- [x] Implement additive file-context migration, seed, contract, transformer, and metadata verification.
- [x] Run focused tests serially and relevant builds.

### Task 3: Storefront viewer and operational guide

**Files:** product-details/templates/index.tsx; new product-details/components/model3d-viewer components/tests; storefront package and lock if required; docs inventory 3D runbook.

**Interfaces:**

- Consumes `product.metadata.model3dFileId` and existing public file URL helper.
- Produces detail-page-only `3D로 보기` button and dialog with rotation/zoom and `대표 옵션 기준` notice.

- [x] Write and run failing tests for absent model, no load before click, lazy loading after click, close/error behavior, and representative-option notice.
- [x] Implement a lazy model viewer with a maintained GLB viewer dependency, accessible dialog, loading/error states, and cleanup.
- [x] Document compression (Draco/meshopt and KTX2/WebP), public context migration-before-deploy, attach/remove verification, source-photo/model quality workflow and status report template.
- [x] Run focused storefront tests/type checks and capture a UI screenshot when runnable.

### Final verification

- [x] Independent subagent review of each task and whole branch; address material findings and re-review fixes.
- [x] Run all new/affected focused tests serially, formatting/diff checks and scoped builds.
- [x] Report live migration/model-generation/UI verification accurately; never mark unavailable production evidence as completed.

## Verification limits

Live database migrations, the unmanaged production S3 CORS policy, actual captured-SKU generation and quality review remain deployment/operations work.
Local PostgreSQL concurrency and outbox rollback, Medusa HTTP attach/remove, and browser cross-origin file download were exercised.
The browser environment cannot create WebGL2, so real 3D render/rotation is unverified; its error fallback is verified.
Full storefront typecheck has pre-existing unrelated errors; the viewer-scoped typecheck passes.
