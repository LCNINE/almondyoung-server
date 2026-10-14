# 판매주문 라인 구성 PR 4 (contract — 옛 라인 매칭 칸 DROP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 1 이 의미상 쓰기·읽기를 멈춘 옛 칸 셋(`sales_order_lines.product_matching_id`·`mapping_snapshot_id`, `fulfillment_order_items.mapping_snapshot_id`)과 `product_sku_mapping_snapshots` 테이블을 지우고, 그 칸을 아직 들고 있는 코드(Drizzle 스키마·DTO·삽입 리터럴)를 걷는다.

**Architecture:** 한 PR, 배포 순서 **`sst deploy` → Core 롤아웃 완료 확인 → `db:migrate`**(ADR-0005 §5 contract 순서). Drizzle 은 스키마에 선언된 칸을 `select()`·`insert()` 마다 전부 SQL 에 싣기 때문에 «코드 사용 중단» = «schema.ts 에서 지우기»이고, 그걸 마이그와 갈라 두 PR 로 만들면 스냅샷이 schema.ts 와 어긋나 남의 다음 `db:generate:core` 가 이 DROP 을 엉뚱한 마이그에 쓸어 담는다. 그래서 «옛 코드가 DROP 을 만나지 않게»는 PR 분할이 아니라 배포 순서가 지킨다. drizzle-kit 이 만든 SQL 은 순서 결함이 있어(아래 Task 2) 손으로 순서를 고친다 — 아직 어디에도 적용되지 않은 마이그라 허용된다.

**Tech Stack:** NestJS 11 · Drizzle ORM / drizzle-kit · postgres.js · Jest 29(ts-jest)

**Spec:** `docs/superpowers/specs/2026-10-13-sales-order-line-composition-design.md` §9.4·§9.5·§12-4 (이슈 #1063, #1016 14번 행). 앞 PR 계획: `docs/superpowers/plans/2026-10-13-sales-order-line-composition-pr1.md`·`…-pr2.md`, `docs/superpowers/plans/2026-10-14-sales-order-line-composition-pr3.md`.

## 계획 전 확인 결과 (2026-10-15 01:00 KST 실측)

이 계획의 판단 근거다. 실행 직전(Task 3)과 배포 직전에 같은 확인을 다시 한다.

**시작 조건**
- PR 1 #1064(`60913c07d`)·PR 2 #1066(`d78d94fed`) 라이브: Core td 242 등록 10-14 20:25 KST, 롤아웃 COMPLETED 20:28. td 242 등록 뒤 develop 에 들어온 커밋은 `19fefcff9`(문서)·`aa6a34a84`(PR 3 #1071) 둘뿐 → **PR 3 은 미배포**
- PR 3 과 PR 4 는 한 번의 `sst deploy` 로 나간다

**이번 배포에 같이 실리는 것**
- `git diff --name-only d78d94fed origin/develop -- 'apps/*/drizzle/*.sql'` → **0건.** 실리는 마이그는 PR 4 의 것 하나뿐이다
- 라이브 적용 수: core `drizzle.__drizzle_migrations` 116 = 로컬 journal 116, wallet 19 = 19
- 코드: PR 3 의 admin-web 19파일·core 7파일·`libs/shared` 2파일(필터 허용목록 — 필터를 쓰는 모든 ECS 번들이 새 이미지로 뜬다). 마이그 없음
- **#1016 36번 마무리(#1061·#1062)는 이미 라이브다** — Wallet td 183 이 10-13 14:44 KST 에 등록됐고(#1061 머지 10-13 06:49 KST 뒤), wallet `cron_runs` 의 `refund-stuck-resend` 첫 실행이 10-13 14:50 KST, 10-15 01:00 까지 411회. #1062 는 Core td 241(10-13 15:42)부터 실렸다. 그런데 #1016 «남은 운영 작업»의 «36번 행 마무리 배포 — 배포 전에 #1061 본문의 라이브 SQL ①②» 체크박스는 **미체크**다. 이 게이트는 이번 배포의 선행조건이 아니다(이미 지나갔다). 사후 확인 여부는 PR 4 범위 밖이고 사람이 정한다

**스펙 §9.5 라이브 확인**
- «FO 항목이 있는데 출처 NULL» 라인: **전체 0, 남은 단위 > 0 인 것(게이트 값) 0** → 통과
- 지울 칸의 값: `sales_order_lines.product_matching_id` NOT NULL **680행**, `sales_order_lines.mapping_snapshot_id` 0, `fulfillment_order_items.mapping_snapshot_id` 0, `product_sku_mapping_snapshots` 0행. 680행은 옛 «SKU 연결 저장»이 variant 의 모든 라인에 덮어쓴 주소다 — `product_matchings` 는 `unique(variant_id)` 라 이 값은 `variant_id` 로 언제든 다시 얻을 수 있다. **백업하지 않는다**
- 이 칸·테이블에 기대는 뷰: 없음. 스냅샷 테이블을 가리키는 FK: 두 칸의 FK 둘뿐
- 옛 칸을 읽는 코드(grep): 아래 «옛 칸 사용처 전수»

**drizzle generate**
- `drizzle-kit check` → «Everything's fine». 변경 없이 `generate` → «No schema changes» — 스냅샷 체인과 schema.ts 가 일치한다
- 칸·테이블을 지우고 `generate` → **DROP 만 나오고 rename 프롬프트는 없었다**(추가되는 칸이 없으므로)
- 🔴 **그대로는 적용이 실패한다.** 생성 순서가 `DROP TABLE "product_sku_mapping_snapshots" CASCADE` → `ALTER TABLE "fulfillment_order_items" DROP CONSTRAINT "…mapping_snapshot_id…_fk"` 인데, CASCADE 가 그 FK 를 이미 지워서 `constraint "fulfillment_order_items_mapping_snapshot_id_product_sku_mapping" … does not exist` 로 죽는다(`core_1063` 롤백 트랜잭션으로 재현). FK → 인덱스 → 칸 → 테이블 순으로 바꾼 판은 통과한다(같은 방법으로 확인) — Task 2

## 옛 칸 사용처 전수 (2026-10-15, develop `aa6a34a84`)

이름이 같은 `product_variant_sku_links.product_matching_id`(링크 테이블, 지우지 않음)가 섞여 있어 칸 단위로 가렸다.

**PR 1 이 이미 지운 것** — 스펙 §9.4 가 PR 4 에 적은 `getMappingSnapshot`·`createSnapshotForVariant`·admin-web `lib/types/dto/orders.ts` 의 두 칸은 `60913c07d` 에서 사라졌다. §12-4(admin-web 이 어디서 읽나)의 답: **어디서도 안 읽는다** — 주석 한 줄(`demo-order-line.ts:5`)만 남았다.

**PR 4 가 고칠 곳**

| 파일 | 자리 | 무엇 |
| --- | --- | --- |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | `salesOrderLines` 의 두 칸·`idxMappingSnapshot`, `productSkuMappingSnapshots` 테이블, `fulfillmentOrderItems.mappingSnapshotId`, 관계 6곳·스키마 객체 1곳·타입 2개 | Task 2 |
| `apps/core/src/modules/product-matching/schema/matching.schema.ts` | re-export 4줄 | Task 2 |
| `apps/core/src/modules/sales-order/schema/sales-order.schema.ts:5` · `apps/core/src/platform/database/merged-schema.ts:28` | 주석에 테이블 이름 | Task 2 |
| `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` | `FulfillmentOrderItemInsert.mappingSnapshotId`(50) · 삽입 리터럴 3곳(182·200·469) | Task 1 |
| `apps/core/src/modules/fulfillment/dto/create-fulfillment-order.dto.ts:38-41` | 입력 DTO `mappingSnapshotId` | Task 1 |
| `apps/core/src/modules/fulfillment/draft-box/draft-box-amender.ts:271` | 삽입 리터럴 | Task 1 |
| `apps/core/src/modules/sales-order/dto/sales-order-response.dto.ts:14-18` | 응답 DTO 두 칸 | Task 1 |
| `apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts:52·63·168·170` | 픽스처 `insertLine` 의 `productMatchingId` | Task 1 |
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts:745` · `apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts:65` · `apps/admin-web/src/features/order/history/hooks/demo-order-line.ts:5` | 주석 | Task 1 |

**고치지 않는 곳(전부 링크 테이블 `product_variant_sku_links.product_matching_id`)** — `demand-series.writer.ts`(`FROM product_variant_sku_links`), `product-sellable-quantity.service.ts`·`sku-catalog.manager.ts`·`stock-valuation.reader.ts`·`product-sku-mapping.service.ts`·`product-matching.service.ts`·`variant-matching.strategy.ts`·`product-versions.service.ts`(`productVariantSkuLinks.productMatchingId`), `stock-projection.reader.ts`·`line-resolved.sql.ts`·`demo-catalog.service.ts`(`sl`·`l`·`resolved_k` 가 링크 테이블), `demo-replenishment.manager.ts`(`k`), `scripts/sellmate/*`·`scripts/ops/1016-row12-*`(`l`), `apps/channel-adapter/scripts/*`, `scripts/seeding/steps/demo-logistics.seed-step.ts`, `scripts/demo/catalog-*`, `scripts/local/seed-dev-core/orders.ts`, 각 스펙 픽스처.
**저장소 밖 영역:** `apps/medusa`·`web/`·`native/`·`packages/`·`libs/` 0건. core 스키마를 import 하는 다른 앱은 `apps/channel-adapter/src/services/order-collection/order-line-identity.roundtrip.spec.ts`(스펙, 옛 칸 안 씀)뿐. 배포 단위에 Lambda 없음. 시드·스크립트는 루트 `type-check` 범위라 Drizzle 참조가 남으면 Task 2 에서 잡힌다.

## Global Constraints

- **시작 조건:** PR 3 #1071 은 develop `aa6a34a84` 에 머지·미배포, PR 1·2 는 라이브(Core td 242). 다르면 멈추고 묻는다
- 워크트리: `/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1063-line-composition-pr4`(브랜치 `feat/1063-line-composition-pr4`, `origin/develop` `aa6a34a84` 에서 만듦 — 이미 있다). node_modules 는 설치하지 않고 **절대경로 심링크** 셋(이미 걸려 있다):
  ```bash
  WT=/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1063-line-composition-pr4
  M=/home/pauseb/workspace/almondyoung-server
  [ -e $WT/node_modules ] || ln -s $M/node_modules $WT/node_modules
  [ -e $WT/apps/admin-web/node_modules ] || ln -s $M/apps/admin-web/node_modules $WT/apps/admin-web/node_modules
  [ -e $WT/native/warehouse-app/node_modules ] || ln -s $M/native/warehouse-app/node_modules $WT/native/warehouse-app/node_modules
  ```
  서브에이전트는 워크트리 밖(메인 체크아웃)을 고치지 않는다 — 태스크 끝에 `git -C /home/pauseb/workspace/almondyoung-server status --short` 가 `?? scripts/ops/1016-36-ambiguous-refund-preflight.js` 하나뿐인지 본다
- 게이트(모두 0): `npm run type-check` · `npx jest --maxWorkers=2` · `npm run test:admin-web` · `(cd apps/admin-web && npx tsc --noEmit)` — CI 는 admin-web tsc 를 돌리지 않는다
- core 통합 스펙은 **스크래치 DB `core_1063`** 로만 돌린다(지금 라이브와 같은 116개 적용 상태). 공유 postgres 컨테이너를 다시 만드는 러너(`test:core:integration:local` 등)는 쓰지 않는다:
  ```bash
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath <파일…>
  ```
- 마이그는 **하나**, 이름 `drop-legacy-line-matching-columns`. schema.ts·SQL·`drizzle/meta/` 는 **한 커밋**(CLAUDE.md)
- 라이브 `db:migrate`·라이브 쓰기는 하지 않는다 — 사용자가 대상과 행동을 짚어 직접 실행한다. 라이브 읽기 스크립트는 `READ ONLY` 트랜잭션만
- core: `any`·`as` 캐스팅 금지. 코드 주석은 한국어로 «왜»만. 채팅 서식(화살표·굵게) 금지
- 이 PR 은 동작을 바꾸지 않는다 — 판정·FO 생성·응답 의미는 PR 1~3 그대로이고, 응답 JSON 에서 두 칸(`productMatchingId`·`mappingSnapshotId`)이 사라지는 것만 바뀐다

## Review Focus

- **drizzle-kit 이 만든 SQL 을 그대로 두면 라이브 `db:migrate` 가 실패한다**(CASCADE 가 지운 FK 를 다시 DROP CONSTRAINT) → Task 2 가 순서를 고친 SQL 을 **실제 migrator(`drizzle-kit migrate`)로** `core_1063` 에 적용하고 117개·칸 0·테이블 없음을 확인한다
- **Core 롤아웃이 끝나기 전에 `db:migrate` 가 돌면** 옛 td 242 태스크의 `sales_order_lines`·`fulfillment_order_items` 조회·삽입이 전부 `column … does not exist` 로 죽는다(Drizzle 은 선언된 칸을 다 싣는다). 같은 배포에 `migrate → deploy` 를 요구하는 남의 마이그가 끼면 운영자가 습관대로 먼저 migrate 해서 이게 일어난다 → Task 3 의 사전 점검 스크립트 ④(적용 수 116)와 PR 본문 배포 절차 0단계(`git diff` 로 실리는 마이그가 이것 하나인지)
- **tsc 가 못 보는 raw SQL 이 지운 칸을 읽으면** 런타임에야 터진다 → Task 2 가 마이그 적용된 `core_1063` 에서 두 테이블을 만지는 통합 스펙 전부를 돌려 기준선과 비교한다(기준선은 같은 DB 의 마이그 전 실행)
- **DROP 이 긴 트랜잭션 뒤에서 ACCESS EXCLUSIVE 잠금을 기다리면** 그동안 판매주문 라인·FO 항목 쓰기가 전부 줄을 선다 → 마이그 첫 줄 `SET LOCAL lock_timeout = '10s'`(선례 `20260914154449_guard-purchase-order-receiving-contract.sql`). 넘으면 마이그가 실패하고 다시 돌리면 된다 — Task 2 Step 5 가 첫 줄을 확인한다
- **스냅샷이 schema.ts 와 어긋난 채 머지되면** 다음 사람의 `db:generate:core` 가 DROP 을 다시 내거나 빠뜨린다 → Task 2 의 `drizzle-kit check` + 변경 없는 `generate` 가 «No schema changes»

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` · `dto/create-fulfillment-order.dto.ts` · `draft-box/draft-box-amender.ts` (수정) | FO 항목 삽입이 옛 칸을 더 들지 않는다 |
| `apps/core/src/modules/sales-order/dto/sales-order-response.dto.ts` (수정) | 응답 DTO 에서 두 칸 제거 |
| `apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts` (수정) | 픽스처가 옛 칸을 안 쓴다 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` · `product-matching/schema/matching.schema.ts` (수정) | 칸·테이블·관계·타입 제거 |
| `apps/core/drizzle/<timestamp>_drop-legacy-line-matching-columns.sql` · `drizzle/meta/<timestamp>_snapshot.json` · `drizzle/meta/_journal.json` (생성) | DROP 마이그 |
| `scripts/ops/1063-pr4-contract-preflight.js` (신규) | 배포 직전·migrate 직전 라이브 읽기 전용 점검 |
| `docs/superpowers/specs/2026-10-13-sales-order-line-composition-design.md` (수정) | §9.4 범위 정정·§12-4 답 |
| 주석 4곳 (`sales-orders.service.ts`·`logistics-fixtures.ts`·`demo-order-line.ts`·`sales-order.schema.ts`·`merged-schema.ts`) | 사라진 칸 이름을 가리키지 않게 |

---

### Task 1: 코드가 옛 칸을 더 들지 않는다 (스키마는 그대로)

스키마에 칸이 남아 있는 동안 코드 쪽 참조를 먼저 걷는다. 칸이 NULL 허용이라 삽입에서 빼도 동작이 같고, `type-check` 가 이 단계에서도 초록이어야 Task 2 의 빨강이 «스키마가 지워져서»만 남는다.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:50,182,200,469`
- Modify: `apps/core/src/modules/fulfillment/dto/create-fulfillment-order.dto.ts:38-41`
- Modify: `apps/core/src/modules/fulfillment/draft-box/draft-box-amender.ts:271`
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-response.dto.ts:14-18`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts:46-65,168-170`
- Modify(주석): `apps/core/src/modules/sales-order/services/sales-orders.service.ts:745`, `apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts:65`, `apps/admin-web/src/features/order/history/hooks/demo-order-line.ts:5`

**Interfaces:**
- Consumes: 없음
- Produces: `FulfillmentOrderItemInsert` 에 `mappingSnapshotId` 없음. `CreateFulfillmentOrderItemDto` 에 `mappingSnapshotId` 없음(전역 ValidationPipe 가 `whitelist: true`·`forbidNonWhitelisted: false` 라 옛 호출자가 보내도 400 이 아니라 조용히 잘린다 — 라이브 FO 항목 값 0건). `SalesOrderLineResponseDto` 에 `productMatchingId`·`mappingSnapshotId` 없음

- [ ] **Step 1: 빨강 — 걷을 참조를 센다**

```bash
cd /home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1063-line-composition-pr4
grep -rnE "mappingSnapshotId|productMatchingId: string \| null|productMatchingId: l\.productMatchingId|\{ productMatchingId: null \}" \
  apps/core/src/modules/fulfillment apps/core/src/modules/sales-order --include=*.ts
```
Expected: 12줄 — `fulfillments.service.ts` 4(50·182·200·469), `create-fulfillment-order.dto.ts` 1(41), `draft-box-amender.ts` 1(271), `sales-order-response.dto.ts` 2(15·18), `sales-orders.list.integration.spec.ts` 3(52·63·170), `logistics-fixtures.ts` 1(65, 주석). 숫자가 다르면 그 줄을 읽고 위 «사용처 전수» 표에 없는 자리인지 판단한다(없는 자리면 멈추고 보고)

- [ ] **Step 2: `fulfillments.service.ts` — 타입과 삽입 리터럴 3곳**

`FulfillmentOrderItemInsert` 에서 지운다:
```ts
type FulfillmentOrderItemInsert = {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  variantId: string | null;
  skuId: string;
  qty: number;
  reservedQty: number;
  pickedQty: number;
  shippedQty: number;
  status: string;
};
```
명시 항목 경로(182 부근) — `mappingSnapshotId: item.mappingSnapshotId ?? null,` 줄을 지운다:
```ts
          return {
            salesOrderId: null,
            salesOrderLineId: null,
            variantId: item.variantId ?? null,
            skuId: item.skuId,
```
레거시 라인 경로(200 부근)와 판매주문 경로(469 부근) — 각각 `mappingSnapshotId: null,` 한 줄을 지운다:
```ts
          return {
            salesOrderId: null,
            salesOrderLineId: null,
            variantId: null,
            skuId: line.skuId,
```
```ts
        items.push({
          salesOrderId,
          salesOrderLineId: line.id,
          variantId: line.variantId,
          skuId: item.skuId,
```

- [ ] **Step 3: 입력 DTO·amender·응답 DTO**

`create-fulfillment-order.dto.ts` — `CreateFulfillmentOrderItemDto` 끝의 네 줄을 지워 클래스가 `salesOrderId?: string;` 로 끝나게 한다:
```ts
  @ApiProperty({
    description: 'Not accepted for explicit item creation. Use top-level salesOrderId without items.',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  salesOrderId?: string;
}
```
`draft-box-amender.ts` 271 — `mappingSnapshotId: null,` 한 줄을 지운다:
```ts
      .values({
        fulfillmentOrderId,
        salesOrderId: template.salesOrderId,
        salesOrderLineId,
        variantId: template.variantId,
        skuId,
```
`sales-order-response.dto.ts` — `variantId` 다음의 두 속성(데코레이터 포함 6줄)을 지운다:
```ts
  @ApiProperty({ description: 'Product variant ID (PIM)' })
  variantId: string;

  // 상세·목록 응답만 채운다(라인 조회가 술어를 함께 select 한다)
  @ApiProperty({
```

- [ ] **Step 4: 목록 통합 스펙의 픽스처**

`insertLine` 의 선택 인자에서 `productMatchingId` 를 빼고 삽입에서도 뺀다:
```ts
async function insertLine(
  tx: DbTx,
  salesOrderId: string,
  l: Partial<{
    status: 'pending' | 'matched' | 'stock_deducted' | 'stock_unavailable' | 'cancelled';
    productName: string;
  }> = {},
): Promise<void> {
  await tx.insert(wmsTables.salesOrderLines).values({
    salesOrderId,
    variantId: randomUUID(),
    productName: l.productName ?? 'IT Product',
    quantity: 1,
    unitPrice: 1000,
    status: l.status ?? 'pending',
  });
}
```
`typeGroup: unmatched` 테스트(168·170)는 뜻이 «라인 칸이 아니라 대기열 기준»이므로 그대로 두고 옛 칸 언급만 바꾼다:
```ts
      // 대기열이 끝난 주문은 «매칭안됨» 이 아니다 — 14번 행의 오탐은 옛 라인 칸으로 판정해서 생겼다
      const done = await insertOrder(tx, { channelOrderId: `${tag}-done` });
      await insertLine(tx, done);
```

- [ ] **Step 5: 주석 셋**

`sales-orders.service.ts:745`:
```ts
    // 라인 배지(«매칭 대기»)는 이 값을 본다(#1063)
```
`logistics-fixtures.ts:65`:
```ts
// SO + 라인. 라인 구성 출처는 default null → FO 생성이 그때의 상품매칭을 따른다. variantId 는 임의 UUID.
```
`apps/admin-web/src/features/order/history/hooks/demo-order-line.ts:5`:
```ts
  // core 가 라인 구성 판정으로 내려준 값을 본다(#1063).
```

- [ ] **Step 6: 초록 — 참조 0, 타입·유닛**

```bash
grep -rnE "mappingSnapshotId|productMatchingId: string \| null|productMatchingId: l\.productMatchingId|\{ productMatchingId: null \}" \
  apps/core/src/modules/fulfillment apps/core/src/modules/sales-order --include=*.ts
```
Expected: 출력 없음
```bash
npm run type-check
npx jest --maxWorkers=2 apps/core/src/modules/fulfillment apps/core/src/modules/sales-order
(cd apps/admin-web && npx tsc --noEmit)
```
Expected: 에러 0 · 실패 0 · 에러 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment apps/core/src/modules/sales-order apps/admin-web/src/features/order/history/hooks/demo-order-line.ts
git commit -m "$(cat <<'EOF'
refactor(core): FO 항목 삽입·응답 DTO 가 옛 라인 매칭 칸을 더 들지 않는다 (#1063 PR 4)

PR 1 이 의미상 쓰기·읽기를 멈춘 mapping_snapshot_id·product_matching_id 를
삽입 리터럴·입력/응답 DTO·스펙 픽스처에서 걷는다. 스키마는 다음 커밋이 지운다.

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
EOF
)"
git -C /home/pauseb/workspace/almondyoung-server status --short
```
Expected(마지막 줄): `?? scripts/ops/1016-36-ambiguous-refund-preflight.js` 하나뿐

---

### Task 2: 스키마에서 지우고 DROP 마이그를 만든다 (순서 고친 SQL)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Modify: `apps/core/src/modules/product-matching/schema/matching.schema.ts`
- Modify(주석): `apps/core/src/modules/sales-order/schema/sales-order.schema.ts:5`, `apps/core/src/platform/database/merged-schema.ts:28`
- Create(generate): `apps/core/drizzle/<timestamp>_drop-legacy-line-matching-columns.sql`, `apps/core/drizzle/meta/<timestamp>_snapshot.json`; Modify: `apps/core/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: Task 1 이후 코드가 옛 칸을 참조하지 않음
- Produces: `wmsTables.salesOrderLines` 에 `productMatchingId`·`mappingSnapshotId` 없음, `wmsTables.fulfillmentOrderItems` 에 `mappingSnapshotId` 없음, `productSkuMappingSnapshots`·`productSkuMappingSnapshotsRelations`·`ProductSkuMappingSnapshot`·`NewProductSkuMappingSnapshot` export 없음. core 마이그 117개

- [ ] **Step 1: 기준선 — 마이그 전 `core_1063` 에서 두 테이블을 만지는 통합 스펙**

```bash
cd /home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1063-line-composition-pr4
docker exec almondyoung-server-postgres-1 psql -U postgres -d core_1063 -Atc "select count(*) from drizzle.__drizzle_migrations"
```
Expected: `116`. 아니면 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx drizzle-kit migrate --config apps/core/drizzle.config.ts` 로 116 까지 올린 뒤 계속한다(117 이면 멈추고 보고 — 이미 누가 적용했다)
```bash
SPECS=$(grep -rlE "salesOrderLines|fulfillmentOrderItems|sales_order_lines|fulfillment_order_items" apps/core/src libs scripts --include=*.integration.spec.ts | sort)
echo "$SPECS" | wc -l
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath $SPECS 2>&1 | tee /tmp/claude-1000/1063-pr4-baseline.txt | tail -8
```
Expected: 파일 약 42개. 실패가 있으면 그 테스트 이름을 적어 둔다(알려진 기준 RED: `shipment-planning` tombstone entrance-password 1건, `waybill.manager.integration` «definitive rejection»). 이게 Step 7 의 비교 기준이다

- [ ] **Step 2: `inventory.schema.ts` — 칸·인덱스·테이블**

`salesOrderLines` 에서 `variantId` 다음 네 줄을 지운다 — 결과:
```ts
    variantId: uuid('variant_id').notNull(), // PIM의 Variant ID
    // #1063: 이 라인에 적용할 SKU 구성을 굳혔는지·누가 굳혔는지. NULL 이면 아직 현재 상품매칭을 따른다.
```
같은 테이블의 인덱스 블록에서 `idxMappingSnapshot: index('idx_sales_order_lines_snapshot').on(t.mappingSnapshotId),` 한 줄을 지운다.

`/** 주문시점 매핑 스냅샷 (불변) */` 주석부터 `export const productSkuMappingSnapshots = pgTable(…);` 끝(`idxProduct` 인덱스 블록을 닫는 `);`)까지 통째로 지운다.

`fulfillmentOrderItems` 에서 세 줄을 지운다 — 결과:
```ts
    salesOrderLineId: varchar('sales_order_line_id', { length: 255 }), // 원본 SOL ID
    variantId: uuid('variant_id'), // PIM Variant ID - 정책 평가용
```

- [ ] **Step 3: `inventory.schema.ts` — 관계·스키마 객체·타입**

정확히 아래 조각들을 지운다(각각 파일에 한 번씩 나온다):
1. 스키마 객체(`// FOI 기반 확장 스키마` 아래)의 `  productSkuMappingSnapshots,` 한 줄
2. `skus` 관계의 `  productSkuMappingSnapshots: many(productSkuMappingSnapshots),` (`productSkuMappingItems: many(…)` 바로 다음 줄)
3. `warehouses` 관계의 `  productSkuMappingSnapshots: many(productSkuMappingSnapshots),` (`productSkuMappings: many(productSkuMappings),` 바로 다음 줄)
4. `productMatchingsRelations` 의 `  salesOrderLines: many(salesOrderLines),` — 결과:
   ```ts
   export const productMatchingsRelations = relations(productMatchings, ({ one, many }) => ({
     productVariantSkuLinks: many(productVariantSkuLinks),
   }));
   ```
5. `salesOrderLinesRelations` 의 `productMatching: one(productMatchings, { fields: [salesOrderLines.productMatchingId], references: [productMatchings.id] }),` 블록 4줄
6. `fulfillmentOrderItemsRelations` 의 `mappingSnapshot: one(productSkuMappingSnapshots, { … }),` 블록 4줄
7. `export const productSkuMappingSnapshotsRelations = relations(…)` 블록 전체(`}));` 까지)
8. 관계 묶음(`// Product-SKU Mapping Relations` 아래)의 `  productSkuMappingSnapshotsRelations,` 한 줄
9. 타입 두 줄 `export type ProductSkuMappingSnapshot = …` · `export type NewProductSkuMappingSnapshot = …`

`productMatchingsRelations` 의 `one` 이 안 쓰이게 돼도 그대로 둔다(기존 모양, tsc 는 구조분해 미사용을 막지 않는다).

```bash
grep -n "productSkuMappingSnapshot\|mappingSnapshot\|salesOrderLines.productMatchingId" apps/core/src/modules/inventory/schema/inventory.schema.ts
```
Expected: 출력 없음

- [ ] **Step 4: re-export·주석, 그리고 type-check**

`matching.schema.ts` 에서 `productSkuMappingSnapshots` 가 든 네 줄(`productSkuMappingSnapshots,` 셋, `productSkuMappingSnapshotsRelations,` 하나)을 지운다:
```bash
sed -i '/productSkuMappingSnapshots/d' apps/core/src/modules/product-matching/schema/matching.schema.ts
```
`sales-order.schema.ts:5`·`merged-schema.ts:28` 의 `(product_matchings, product_sku_mapping_snapshots 등과의 FK 참조로 분리 불가)` 를 `(product_matchings 등과의 FK 참조로 분리 불가)` 로 바꾼다(`merged-schema.ts` 는 앞의 `//   ` 들여쓰기 유지).
```bash
npm run type-check
```
Expected: 에러 0. 에러가 나면 그 자리는 위 «사용처 전수»가 놓친 Drizzle 참조다 — 고치고 계획 표에 한 줄 더한 뒤 보고한다

- [ ] **Step 5: generate → 순서 고치기**

```bash
npx drizzle-kit generate --config apps/core/drizzle.config.ts --name drop-legacy-line-matching-columns
F=$(ls apps/core/drizzle/*_drop-legacy-line-matching-columns.sql); echo $F; cat $F
```
Expected: rename 을 묻는 프롬프트 없음. 내용은 9문장 — `DISABLE ROW LEVEL SECURITY`, `DROP TABLE "product_sku_mapping_snapshots" CASCADE`, `DROP CONSTRAINT` 셋, `DROP INDEX "idx_sales_order_lines_snapshot"`, `DROP COLUMN` 셋. 이와 다르면(빠지거나 더 있으면) 멈추고 보고한다.

CASCADE 가 FK 둘을 먼저 지워 뒤의 `DROP CONSTRAINT` 가 «does not exist» 로 실패하므로, 파일 전체를 아래로 바꾼다(아직 어디에도 적용 안 된 마이그다). FK·인덱스·칸을 먼저 지우면 테이블을 가리키는 것이 없어 CASCADE 가 필요 없다:
```sql
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" DROP CONSTRAINT "fulfillment_order_items_mapping_snapshot_id_product_sku_mapping_snapshots_id_fk";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_product_matching_id_product_matchings_id_fk";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_mapping_snapshot_id_product_sku_mapping_snapshots_id_fk";--> statement-breakpoint
DROP INDEX "idx_sales_order_lines_snapshot";--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" DROP COLUMN "mapping_snapshot_id";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "product_matching_id";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "mapping_snapshot_id";--> statement-breakpoint
DROP TABLE "product_sku_mapping_snapshots";
```
FK 이름은 63자를 넘어 Postgres 가 잘라 비교한다(라이브 이름 `fulfillment_order_items_mapping_snapshot_id_product_sku_mapping` 등과 같아진다 — 2026-10-15 `core_1063` 에서 확인). `meta/*_snapshot.json` 은 고치지 않는다 — SQL 순서는 스냅샷에 안 들어간다.
```bash
head -1 $F
```
Expected: `SET LOCAL lock_timeout = '10s';--> statement-breakpoint`

- [ ] **Step 6: 실제 migrator 로 `core_1063` 에 적용하고 확인**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
docker exec almondyoung-server-postgres-1 psql -U postgres -d core_1063 -Atc "
  select count(*) from drizzle.__drizzle_migrations;
  select count(*) from information_schema.columns
   where (table_name='sales_order_lines' and column_name in ('product_matching_id','mapping_snapshot_id'))
      or (table_name='fulfillment_order_items' and column_name='mapping_snapshot_id');
  select to_regclass('public.product_sku_mapping_snapshots') is null;"
```
Expected: `117` · `0` · `t`
```bash
npx drizzle-kit check --config apps/core/drizzle.config.ts
npx drizzle-kit generate --config apps/core/drizzle.config.ts --name probe-no-change
git status --short apps/core/drizzle
```
Expected: «Everything's fine» · «No schema changes, nothing to migrate» · 새 SQL·snapshot 두 파일과 `_journal.json` 수정만(probe 파일 없음)

- [ ] **Step 7: 초록 — 마이그 적용된 DB 에서 같은 통합 스펙**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath $SPECS 2>&1 | tee /tmp/claude-1000/1063-pr4-after.txt | tail -8
grep -E "^\s+●" /tmp/claude-1000/1063-pr4-baseline.txt | sort > /tmp/claude-1000/1063-pr4-base-fails.txt
grep -E "^\s+●" /tmp/claude-1000/1063-pr4-after.txt | sort > /tmp/claude-1000/1063-pr4-after-fails.txt
diff /tmp/claude-1000/1063-pr4-base-fails.txt /tmp/claude-1000/1063-pr4-after-fails.txt && echo SAME
```
Expected: `SAME`(Step 1 과 같은 실패만). 새 실패에 `column … does not exist`·`relation "product_sku_mapping_snapshots" does not exist` 가 있으면 tsc 가 못 본 raw SQL 이다 — 그 자리를 고치고 «사용처 전수»에 더한다. (`$SPECS` 는 Step 1 과 같은 셸에서 다시 구한다: 위 Step 1 의 `SPECS=$(…)` 줄)

- [ ] **Step 8: 커밋 (schema + SQL + meta 한 커밋)**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
  apps/core/src/modules/product-matching/schema/matching.schema.ts \
  apps/core/src/modules/sales-order/schema/sales-order.schema.ts \
  apps/core/src/platform/database/merged-schema.ts \
  apps/core/drizzle
git commit -m "$(cat <<'EOF'
feat(core)!: 옛 라인 매칭 칸·주문시점 매핑 스냅샷 테이블 DROP (#1063 PR 4)

sales_order_lines.product_matching_id·mapping_snapshot_id,
fulfillment_order_items.mapping_snapshot_id, product_sku_mapping_snapshots 를 지운다.
drizzle-kit 이 낸 순서(CASCADE 뒤 같은 FK 를 DROP CONSTRAINT)는 적용이 실패해서
FK → 인덱스 → 칸 → 테이블 순으로 고쳤다. 배포는 deploy → (Core 롤아웃 완료) → migrate.

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
EOF
)"
git -C /home/pauseb/workspace/almondyoung-server status --short
```
Expected(마지막 줄): `?? scripts/ops/1016-36-ambiguous-refund-preflight.js` 하나뿐

---

### Task 3: 사전 점검 스크립트·스펙 정정·게이트·PR

**Files:**
- Create: `scripts/ops/1063-pr4-contract-preflight.js`
- Modify: `docs/superpowers/specs/2026-10-13-sales-order-line-composition-design.md` §9.4·§12-4

**Interfaces:**
- Consumes: Task 2 의 마이그 파일 이름
- Produces: 사람이 배포 직전·migrate 직전에 돌리는 읽기 전용 점검

- [ ] **Step 1: 사전 점검 스크립트**

`scripts/ops/1063-pr4-contract-preflight.js`:
```js
// scripts/ops/1063-pr4-contract-preflight.js
// READ ONLY. #1063 PR 4(옛 라인 매칭 칸 DROP) — 머지·배포 직전, 그리고 db:migrate 직전에 한 번 더.
//   ① 스펙 §9.5 게이트: FO 항목이 있는데 출처 NULL 이고 남은 단위가 있는 라인 = 0 이어야 한다
//   ② 지울 칸의 값 — 680행 안팎의 product_matching_id 는 variant_id 로 다시 얻을 수 있는 주소라 버린다
//   ③ 지울 칸·테이블에 기대는 뷰 = 없어야 한다(있으면 DROP COLUMN 이 실패한다)
//   ④ core 적용 마이그 수 — migrate 전 116 이어야 한다(117 이면 이미 적용됨, 116 미만이면 남의 마이그가 밀려 있다)
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/1063-pr4-contract-preflight.js)"
const postgres = require('postgres');
const d = JSON.parse(process.env.SST_RESOURCE_Db);
const sql = postgres({
  host: process.env.DB_TUNNEL_HOST || d.host,
  port: Number(process.env.DB_TUNNEL_PORT || d.port),
  username: d.username,
  password: d.password,
  database: 'core',
  ssl: 'require',
  max: 1,
});

(async () => {
  try {
    await sql.begin('read only', async (tx) => {
      const [gate] = await tx`
        WITH per_line AS (
          SELECT l.id, SUM(foi.qty - foi.canceled_qty) AS live_units
          FROM sales_order_lines l
          JOIN fulfillment_order_items foi ON foi.sales_order_line_id = l.id::text
          WHERE l.composition_source IS NULL
          GROUP BY l.id)
        SELECT COUNT(*)::int AS all_null_with_fo,
               COUNT(*) FILTER (WHERE live_units > 0)::int AS gate_live_units_gt0
        FROM per_line`;
      console.log('① FO 있고 출처 NULL 라인(게이트 = gate_live_units_gt0 = 0):', gate);

      const [cols] = await tx`
        SELECT COUNT(*)::int AS remaining FROM information_schema.columns
        WHERE (table_name = 'sales_order_lines' AND column_name IN ('product_matching_id', 'mapping_snapshot_id'))
           OR (table_name = 'fulfillment_order_items' AND column_name = 'mapping_snapshot_id')`;
      if (cols.remaining > 0) {
        const [old] = await tx`
          SELECT
            (SELECT COUNT(*) FROM sales_order_lines WHERE product_matching_id IS NOT NULL)::int AS sol_product_matching_id,
            (SELECT COUNT(*) FROM sales_order_lines WHERE mapping_snapshot_id IS NOT NULL)::int AS sol_mapping_snapshot_id,
            (SELECT COUNT(*) FROM fulfillment_order_items WHERE mapping_snapshot_id IS NOT NULL)::int AS foi_mapping_snapshot_id,
            (SELECT COUNT(*) FROM product_sku_mapping_snapshots)::int AS snapshot_rows`;
        console.log('② 지울 칸의 값:', old);
      } else {
        console.log('② 칸이 이미 없다 — 마이그가 적용됐다');
      }

      const deps = await tx`
        SELECT DISTINCT c.relname AS dependent_view, t.relname AS on_table, a.attname AS col
        FROM pg_depend dep
        JOIN pg_class t ON t.oid = dep.refobjid
        LEFT JOIN pg_attribute a ON a.attrelid = dep.refobjid AND a.attnum = dep.refobjsubid
        JOIN pg_rewrite r ON r.oid = dep.objid
        JOIN pg_class c ON c.oid = r.ev_class
        WHERE dep.classid = 'pg_rewrite'::regclass
          AND ((t.relname = 'sales_order_lines' AND a.attname IN ('product_matching_id', 'mapping_snapshot_id'))
            OR (t.relname = 'fulfillment_order_items' AND a.attname = 'mapping_snapshot_id')
            OR t.relname = 'product_sku_mapping_snapshots')`;
      console.log('③ 뷰 의존(없어야 한다):', deps.length === 0 ? '없음' : deps);

      const [mig] = await tx`SELECT COUNT(*)::int AS applied FROM drizzle.__drizzle_migrations`;
      console.log('④ core 적용 마이그(migrate 전 116):', mig);
    });
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
라이브에는 돌리지 않는다(사람이 돌린다). `core_1063` 대상으로 모양만 확인할 수 없으므로(SST 자원 필요) 문법만 본다:
```bash
node --check scripts/ops/1063-pr4-contract-preflight.js && echo OK
```
Expected: `OK`

- [ ] **Step 2: 스펙 정정**

§9.4 본문을 아래로 바꾼다:
```markdown
`sales_order_lines.product_matching_id`·`mapping_snapshot_id`, `fulfillment_order_items.mapping_snapshot_id`,
`product_sku_mapping_snapshots` 테이블 DROP. 응답 DTO(`sales-order-response.dto.ts`)의 두 칸과 FO 항목 삽입·입력 DTO 의
`mappingSnapshotId` 제거. 순서 **`deploy → migrate`**.
`getMappingSnapshot`·`createSnapshotForVariant`·admin-web 타입(`lib/types/dto/orders.ts`)의 두 칸은 PR 1(`60913c07d`)이 이미 지웠다.
한 PR 로 낸다 — Drizzle 은 선언된 칸을 모든 select·insert 에 싣기 때문에 «코드 사용 중단»이 곧 schema.ts 에서 지우기이고,
그걸 마이그와 가르면 스냅샷이 어긋나 다른 사람의 다음 generate 가 이 DROP 을 쓸어 담는다. 옛 코드가 DROP 을 만나지 않게 하는 건
배포 순서(Core 롤아웃 완료 뒤 migrate)다. drizzle-kit 이 낸 SQL 은 CASCADE 뒤 같은 FK 를 다시 지우려다 실패해서 순서를 손으로 고쳤다
(PR 4 계획 `docs/superpowers/plans/2026-10-15-sales-order-line-composition-pr4.md`).
```
§12 의 4번 줄을 아래로 바꾼다:
```markdown
4. ~~admin-web 이 `productMatchingId`·`mappingSnapshotId` 를 어디서 읽는지(PR 4 범위)~~ — **어디서도 안 읽는다**(2026-10-15 확인).
   PR 1 이 타입을 지웠고 `isOrderLineMatched` 는 `matchingResolved` 를 본다
```

- [ ] **Step 3: 게이트 넷**

```bash
npm run type-check                                   # 에러 0
npx jest --maxWorkers=2                              # 실패 0 (OOM 이 나면 --maxWorkers=2 그대로 한 번 더)
npm run test:admin-web                               # 실패 0
(cd apps/admin-web && npx tsc --noEmit)              # 에러 0 — CI 가 안 돈다
```

- [ ] **Step 4: 저장소 전체에서 옛 칸 이름 0 (PR 본문에 붙일 결과)**

```bash
grep -rnE "mappingSnapshot|mapping_snapshot|productSkuMappingSnapshot|product_sku_mapping_snapshot" \
  apps libs scripts packages web native --include=*.ts --include=*.tsx --include=*.js --include=*.sql \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next | grep -v "^apps/core/drizzle/"
grep -rnE "salesOrderLines\.productMatchingId|sol\.product_matching_id|sales_order_lines\.product_matching_id" \
  apps libs scripts packages web native --include=*.ts --include=*.tsx --include=*.js --exclude-dir=node_modules
```
Expected: 둘 다 출력 없음(`scripts/ops/1063-pr4-contract-preflight.js` 는 SQL 안의 칸 이름으로 첫 grep 에 걸린다 — 그 파일만 나오면 정상이다). `apps/core/drizzle/` 의 옛 마이그(baseline 등)는 기록이라 제외한다

- [ ] **Step 5: 커밋·push·PR**

```bash
git add scripts/ops/1063-pr4-contract-preflight.js docs/superpowers/specs/2026-10-13-sales-order-line-composition-design.md docs/superpowers/plans/2026-10-15-sales-order-line-composition-pr4.md
git commit -m "$(cat <<'EOF'
docs(ops): #1063 PR 4 사전 점검 스크립트 + 스펙 §9.4·§12-4 정정

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
EOF
)"
git -C /home/pauseb/workspace/almondyoung-server status --short
git push -u origin feat/1063-line-composition-pr4
gh pr create --base develop --title "feat(core)!: 판매주문 라인 구성 PR 4 — 옛 라인 매칭 칸·스냅샷 테이블 DROP (#1063)" --body-file <본문>
```
CI 의 `migration-safety.yml` 이 `destructive-migration` 라벨과 체크리스트 코멘트를 붙인다 — 정상이다.

PR 본문에 반드시 넣을 것:
- 무엇: 스펙 §9.4. 지우는 것 넷, 코드 정리 자리(«사용처 전수» 표), 동작 변화 없음(응답 JSON 에서 두 칸이 사라질 뿐 — 읽는 곳 0)
- 왜 한 PR 인가: Drizzle 은 선언된 칸을 모든 select·insert 에 싣는다 → «사용 중단 PR» 은 곧 schema.ts 에서 지우는 PR 이고, 마이그와 가르면 스냅샷이 어긋난다. PR 1(td 241)·PR 2(td 242) 두 번의 배포가 의미상 사용 중단과 이 PR 사이에 있다
- 마이그 SQL 을 손으로 고친 이유와 `core_1063` 검증(생성본은 `constraint … does not exist` 로 실패, 고친 판은 117·칸 0·테이블 없음)
- Step 4 grep 결과, Task 2 Step 7 의 통합 비교(`SAME`, 기준 RED 목록)
- **배포 절차** (PR 3 #1071 과 한 번에):
  0. 머지 직전: `git fetch && git diff --name-only d78d94fed origin/develop -- 'apps/*/drizzle/*.sql'` 가 이 PR 의 파일 하나뿐인지. 다른 게 있으면 그 PR 의 순서(대개 `migrate → deploy`)를 **PR 4 머지 전에** 끝낸다 — `db:migrate` 는 골라서 적용할 수 없어, 섞이면 그 migrate 가 이 DROP 을 옛 태스크 앞에서 돌린다
  1. `scripts/ops/1063-pr4-contract-preflight.js` → ① `gate_live_units_gt0 = 0` · ③ 없음 · ④ 116
  2. 머지 → `sst deploy --stage live`(PR 3 의 core·admin-web·`libs/shared` 와 함께. 마이그는 아직 돌리지 않는다)
  3. Core 롤아웃 완료 확인: `aws ecs describe-services --cluster lcnine-services-live-ClusterCluster-zbwvckhv --services Core --region ap-northeast-2 --profile login --query 'services[0].deployments[].{td:taskDefinition,state:rolloutState,running:runningCount}'` 가 **한 줄**(새 td, `COMPLETED`)이어야 한다. 두 줄이면 옛 td 242 태스크가 아직 있다 — 기다린다
  4. PR 3 화면 스모크(PR #1071 본문의 네 항목). **이때까지는 td 242 로 되돌릴 수 있다** — migrate 는 서두를 이유가 없다(새 코드는 칸이 있어도 없어도 같다)
  5. 사전 점검 한 번 더(④ 116) → 사람이 대상·행동을 짚어 `db:migrate --stage live --deployment lcnine-services --yes`. 기대: core 117, 다른 서비스 변화 없음
  6. 사전 점검 한 번 더 → ② «칸이 이미 없다» · ④ 117. Core 로그에 `does not exist` 가 없는지
- **되돌리기:** 5단계 전에는 Core td 242 로 그냥 되돌린다. 5단계 뒤에는 앞으로만 간다. 비상시(새 Core 를 내려야 하고 옛 td 로 가야 할 때)만 칸을 빈 채로 되살리면 td 242 가 다시 뜬다:
  ```sql
  ALTER TABLE sales_order_lines ADD COLUMN product_matching_id uuid, ADD COLUMN mapping_snapshot_id uuid;
  ALTER TABLE fulfillment_order_items ADD COLUMN mapping_snapshot_id uuid;
  ```
  (td 242 는 스냅샷 테이블을 읽지 않는다 — PR 1 이 마지막 사용처를 지웠다. 이 SQL 은 journal 밖이므로 쓰고 나면 정리 마이그가 필요하다)
- 끝 줄: `https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`

- [ ] **Step 6: #1063 본문**

«PR 4 전 라이브 확인(스펙 §9.5)» 체크박스는 사용자가 이 계획의 «계획 전 확인 결과»를 승인하면 `[x]` 로 바꾸고 결과(게이트 0·680행 버림·뷰 없음, 2026-10-15)를 같은 줄에 적는다. 배포·migrate 체크박스는 새로 만들지 않고 «PR 4 배포 `deploy → migrate`» 한 줄을 남은 작업에 더한다(이미 있으면 그대로)
