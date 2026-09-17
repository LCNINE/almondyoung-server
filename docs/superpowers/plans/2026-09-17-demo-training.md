# Demo 직원 실습 환경과 가이드 Implementation Plan

> 2026-09-17 형식 결정 변경: 사용자가 Markdown + 앱 실사용 스크린샷으로 형식을 확정했다. 아래 초기 HTML/PDF 제작 항목은 폐기되었으며, 현재 유지·배포 원본은 `docs/demo-training/*.md`와 실제 PNG 캡처다. 발표형 레이아웃과 PDF 파생본은 만들지 않는다. Windows 현장 장비 미검증 표시는 유지한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** live 전체 SKU를 포함한 반복 실습 환경과 Windows 직원용 HTML/가로 PDF 가이드를 제공한다.
**Architecture:** 상품 기준정보는 읽기 전용 스냅샷으로 demo에 가져온다. Core는 DB 기반 demo catalog와 실습 준비를 제공하고 channel-adapter는 저장된 여러 상품 주문을 기존 outbox 경로로 처리한다. 가이드는 실제 UI와 업무 인수 결과를 사용한다.
**Tech Stack:** TypeScript, NestJS, Drizzle/PostgreSQL, Next.js, React/Tauri, HTML/CSS, Playwright/PDF.
**Spec:** ../specs/2026-09-17-demo-training-design.md (사용자 승인 2026-09-17)

## Global Constraints

- Windows PC + 바코드 스캐너·프린터. 물리 장비 미검증을 검증 완료로 표시하지 않는다.
- live는 상품 기준정보 읽기만. 변경 대상은 demo DB와 demo 배포다.
- 기존 직원 주문·발주·재고를 보존한다. 기존 fixture도 유지한다.
- 초기 범위: 일회 스냅샷 + 필요 시 수동 갱신, 수동 주문 묶음 생성, 선택 상품 보충.
- 고객/거래/외부 연동 비밀은 복제하지 않는다. 실제 외부 배송·알림을 보내지 않는다.
- 동일 요청 재시도에서 품목 재추첨·중복 주문·이중 재고 반영이 없어야 한다.

### Task 1: 상품 기준정보 스냅샷과 demo 반영

Files: create scripts/demo/catalog-snapshot.ts, catalog-import.ts, catalog-policy.ts and focused specs; documentation scripts/demo/README.md.
Consumes: live/core read-only connection and demo/core target, existing demo-logistics fixture.
Produces: CLI snapshot/export/audit/import with manifest; all SKU identifiers retained with source deletion state and related catalog/matching/barcodes/supplier attributes. Snapshot metadata stored in demo and import report.

- [x] Inspect real table schema and dependency graph; obtain aggregate source/target audit only.
- [x] Test target stage/identity rejection, field allowlist, idempotent upsert, SKU completeness and relationship validation before implementation.
- [x] Implement explicit table/column selections and repeatable-read read-only export; never serialize credentials or full unfiltered supplier/customer data.
- [x] Import in dependency order, map demo warehouse/holder/delivery profiles, preserve current stock/work and retain existing fixture. Missing physical SKU catalog links get deterministic demo variants.
- [x] Test import into disposable migrated PostgreSQL, run twice, assert stock/work preservation and exact source SKU set containment.
- [x] Apply only verified source snapshot to demo; record aggregate evidence and unresolved exclusions.

```ts
// The importer must fail closed independently of its CLI.
expect(() => assertDemoTarget({ stage: 'live' })).toThrow();
// After a second import, the original source identifiers and demo-owned stock persist.
expect(missingSourceSkuIds).toEqual([]);
expect(stockAfterRefresh).toEqual(stockBeforeRefresh);
```

### Task 2: Core catalog and training readiness

Files: apps/core/src/modules/demo/demo-catalog.service.ts, demo-catalog.service.spec.ts, demo.controller.ts, demo.module.ts, demo.service.ts.
Produces: GET /demo/catalog?search=&page=1&limit=100&variantIds=uuid,uuid, with { items, total, page, limit }; each item { variantId, masterId, versionId, skuId, sku, productName, unitPrice, availableQuantity, components: [{skuId,quantity,availableQuantity}] }. Only physical valid mapped demo-shippable variants appear as order candidates. GET readiness retains fixture checks plus catalog totals.

- [x] Write tests for non-fixture variant, composite SKU availability, deleted SKU exclusion, stable paging, barcode search and malformed filter rejection.
- [x] Use actual active product master/version/variant links; derive stock from sellable warehouses, exclude missing/invalid components.
- [x] Keep full SKU audit separate from order candidate filtering. Preserve existing consumers of items and fixture readiness.
- [x] Test with source import and at least one non-fixture SKU/variant.

```ts
// Bundle availability cannot exceed the limiting component.
expect(Math.min(Math.floor(10 / 2), Math.floor(3 / 1))).toBe(3);
```

### Task 3: Persisted multi-product demo orders

Files: apps/channel-adapter/src/demo/*, apps/channel-adapter/src/schema.ts, channel-adapter Drizzle migration and metadata; focused tests.
Consumes: Task 2 catalog via authenticated trusted Core URL. Forward the requesting admin's authorization to Core; do not trust client product names/prices/stock snapshots.
Produces: additive run input mode='specified'|'random', variantIds?, productsPerOrder?, minQuantity?, maxQuantity?; count remains 1..50. Existing variantId/quantity requests remain replayable. Runs expose input for retry; items expose persisted lines.

- [x] Test multiple distinct variants/order, aggregate and shared-component availability, shortage quantity, exhausted candidates, request replay after catalog changes and partial retry.
- [x] Persist selection and trusted catalog snapshots per run item before ingestion using additive JSON columns; old runs fall back to fixture identity.
- [x] Resolve same request before consulting mutable catalog on replay. Conflicting input returns 409, completed items not resent.
- [x] Provider emits each line with stable deterministic identity and correct totals through existing orchestrator/outbox.
- [x] Run unit and migrated disposable-DB repository integration tests, including old/new run hydration.

```ts
expect(replayed.items.map(i => i.lines)).toEqual(first.items.map(i => i.lines));
expect(new Set(order.items.map(i => i.variantId)).size).toBe(order.items.length);
```

### Task 4: Console and repeatable practice preparation

Files: apps/admin-web/src/features/demo/demo-console.tsx and focused helpers/components; scripts/demo/prepare-practice.ts and tests, Core demo preparation endpoint if suitable domain integration can be reused.
Consumes: Task 2 catalog, Task 3 extended input and item lines.
Produces: searched catalog selection, multi-product run controls, repeat request persistence, per-order contents, guide links; operator preparation tool using existing inbound/putaway APIs.

- [x] Add independent UI model tests for validated bounds and old/new pending request replay.
- [x] Split long console sections if needed. Use server search/pagination, show request acceptance distinct from actual outbound completion.
- [x] Preparation tool takes stable requestId, selected SKU IDs, quantity and destination; uses existing domain APIs and durable local/DB checkpoint keyed by that request, never stock resets.
- [x] Add selected-SKU synthetic demand via demo-only bounded seed, run normal replenishment refresh. Provide barcode/PO/receipt/location handoff information.
- [x] Verify controls at desktop width, create/replay mixed orders and replenish non-fixture SKU.

### Task 5: Detailed guides and Windows delivery

Files: docs/demo-training/{index,retail,warehouse,workshop,operator}.html; assets and shared print CSS, generation script; Windows demo build workflow if no reusable one exists.
Consumes: current verified UI + approved design; successful work IDs from acceptance.
Produces: self-contained HTML guides and 16:9 printable/searchable PDFs; Windows build artifact or exact outstanding toolchain limitation.

- [x] Capture authenticated demo screens without passwords/tokens; read source for exact buttons and recovery states. Do not fabricate screenshots or imply future features are deployed.
- [x] Write full step-by-step Korean role guides with prerequisites, actions, example, result, next owner, troubleshooting.
- [x] Include fixed workshop values and free-practice distinction, barcode/packing-unit input, Windows login callback/scanner/printer checks.
- [x] Generate PDFs from same HTML with readable page layout; render and inspect all pages, verify text extraction and links.
- [x] Build Windows demo through supported Windows toolchain/CI if available; explicitly retain physical device acceptance as requiring the device.

### Task 6: Deployment, acceptance and final review

- [x] Review all diffs and source/target manifest, run scoped tests, TypeScript, UI checks and migration tests.
- [x] Deploy only demo changes using existing SST path, apply additive migrations before corresponding services.
- [x] In deployed demo verify non-fixture lookup, 10-unit PO with 4+6 receipts/putaway, generated multi-product order to mock waybill/outbound, shortage/restock path, same-request replay.
- [x] Refresh guide screenshots/results to deployed version and verify all HTML/PDF pages.
- [x] Record exact completed/unavailable evidence, artifact locations, command outcomes and residual physical-device steps in docs/superpowers/reports/2026-09-17-demo-training.md.

## 완료 기록

구현 및 demo 업무/API 인수 결과와 파일 경로는 `../reports/2026-09-17-demo-training.md`에 기록했다. Windows 설치 파일 빌드는 완료했고, 지정 PC·스캐너·프린터의 실물 확인은 가이드에 미검증으로 명시해 현장 인수 항목으로 남긴다.
