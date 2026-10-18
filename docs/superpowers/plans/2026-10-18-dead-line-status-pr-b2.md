# 죽은 라인 상태 칼럼 DROP (PR ⓑ-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sales_order_lines` 의 `status`·`suggested_quantity`·`unavailable_sku_ids`·`deducted_at` 과 enum `order_item_status` 를 지우고, `typeGroup` 의 옛 값 `ready`·`partial`·`hold` 를 없앤다.

**Architecture:** expand-contract 의 contract 단계. 코드에서 칼럼 정의를 지우고 drizzle 가 만든 DROP 마이그를 싣는다.

**Tech Stack:** Drizzle, NestJS.

**Spec:** `docs/superpowers/specs/2026-10-18-stock-shortage-and-dead-line-status-design.md` (§5.3, §6 ⓑ-2 줄, D11)

## Global Constraints

- **착수 조건:** PR ⓑ-1 이 라이브에 배포되고, 그 뒤 **배포가 한 번 더 끝났다.** 확인은 `git tag -l 'deploy/live/*'` 의 마지막 두 태그 사이에 ⓑ-1 머지 커밋이 있는지로 한다. 아니면 착수하지 않는다.
- **배포 순서는 `deploy → migrate`**(contract). 옛 task 가 DROP 된 칼럼을 만나지 않게.
- 마이그: `npm run db:generate:core -- --name drop-dead-sales-order-line-status`. 생성 SQL 을 **스크래치 DB 에서 먼저 돌린다**(drizzle DROP 순서 함정 — enum 은 칼럼 DROP 뒤).
- `schema.ts` + 마이그 + `drizzle/meta/` 한 커밋.

## Review Focus

- **enum DROP 이 칼럼 DROP 보다 먼저 나옴** — 스크래치 DB 에서 실패 → SQL 순서를 바로잡는다(생성 SQL 손편집은 아직 적용 전이므로 허용).
- **raw SQL 이 칼럼명을 문자열로 씀** — `grep` 으로 0 확인 (Task 1 Step 1).
- **픽스처가 칼럼을 씀** — 통합 스펙이 INSERT 에서 죽는다 → 같이 고친다.
- **옛 admin-web 이 `typeGroup=hold`** — 이 시점엔 ⓑ-1 화면이 두 배포째 떠 있으므로 400 이어도 된다.
- **medusa·channel-adapter 가 이 칼럼을 읽음** — `grep` 0 확인.

---

### Task 1: 칼럼·enum·옛 필터 값 제거

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`orderItemStatusEnum`, `salesOrderLines` 의 네 칼럼)
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-filter.dto.ts:13-21`, `sales-orders.service.ts` (`typeGroup` 세 분기)
- Modify: 칼럼을 쓰는 픽스처 (`fulfillment/order-progress/__support__/order-progress.fixtures.ts`, `fulfillment/services/__support__/consolidation-fixtures.ts`, `fulfillment/waybill/__support__/waybill-fixtures.ts` 등 — Step 1 grep 결과)
- Create: `apps/core/drizzle/<timestamp>_drop-dead-sales-order-line-status.sql` + `meta`

- [ ] **Step 1:** `grep -rnE "orderItemStatusEnum|order_item_status|suggested_quantity|suggestedQuantity|unavailable_sku_ids|unavailableSkuIds|deducted_at|deductedAt|salesOrderLines\.status|sol\.status" apps libs scripts --include=*.ts --include=*.tsx --include=*.js | grep -v node_modules` → 스키마 정의·픽스처 말고 0 줄인지 확인. 아니면 멈추고 ⓑ-1 이 빠뜨린 읽는 곳을 보고한다.
- [ ] **Step 2:** 스키마·DTO·분기·픽스처에서 지운다.
- [ ] **Step 3:** `npm run db:generate:core -- --name drop-dead-sales-order-line-status` → SQL 이 `ALTER TABLE "sales_order_lines" DROP COLUMN …` 넷 뒤에 `DROP TYPE "public"."order_item_status";` 인지 확인.
- [ ] **Step 4:** 스크래치 DB 에서 적용: `npm run test:core:integration:local -- sales-orders` (러너가 마이그를 적용한다) → PASS.
- [ ] **Step 5:** `npm run type-check` 0, `npx jest --maxWorkers=2` 0.
- [ ] **Step 6:** 커밋 `git commit -m "chore(core): 죽은 라인 상태 칼럼과 enum 을 지운다 (#1016 15번)"` → PR. 본문에 **`deploy → migrate`** 와 착수 조건 확인 결과(태그 둘)를 적는다.
