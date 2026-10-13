# 판매주문 라인 구성 PR 2 (core 수정 경로) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 판매주문 라인 하나의 SKU 구성을 FO 생성 전후로 지정하고, 상품매칭 저장 뒤 «기존 출고에도 적용»으로 일괄 반영할 수 있게 한다 — 작성 중(draft) 박스만 바꾼다.

**Architecture:** 박스 목표는 순수 함수 `boxTarget`(라인별 담긴 개수 × 라인 구성) 하나가 정하고, `DraftBoxAmender.amend` 가 작성 중 박스를 그 목표에 맞춘다(S2 가 같은 두 부품을 쓴다). 줄어든 수량은 FO 항목 `qty` 를 줄여 기록하고(0 허용, `canceledQty` 는 고객 취소 전용), 고객 취소 경로는 SKU 비율을 라인 구성에서 읽는다. 주문별 지정·일괄 적용은 `LineCompositionEditManager` 가 판매주문 잠금 아래에서 구성 쓰기(`LineCompositionManager`) → 박스 맞추기 → amendment 기록을 한 트랜잭션으로 한다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), Jest(ts-jest), drizzle-kit

**Spec:** `docs/superpowers/specs/2026-10-13-sales-order-line-composition-design.md` §6·§6.5·§7·§9.2 (이슈 #1063, #1016 14번 행). PR 1 계획 `docs/superpowers/plans/2026-10-13-sales-order-line-composition-pr1.md` 이 형식·수준의 본이다.

## Global Constraints

- 검증 게이트: `npm run type-check` 에러 0 · `npx jest` 실패 0 (CLAUDE.md «검증 게이트»). 이 PR 은 admin-web 을 건드리지 않는다
- 스키마 변경 = `schema.ts` + 생성 SQL + `drizzle/meta/` 를 **한 커밋**에. 생성은 `npm run db:generate:core -- --name <kebab>`. 생성된 SQL 을 손으로 고치지 않는다
- 이 PR 의 마이그레이션은 **1건, 제약 완화만**(`fulfillment_order_items` CHECK `qty > 0` → `qty >= 0`). 배포 순서 `migrate → deploy`
- 통합 스펙은 `describeIfDb`(`process.env.DATABASE_URL` 가드)로 쓰고 스펙 안에서 `dotenv.config()` 를 부르지 않는다
- 통합 스펙은 **스크래치 DB `core_1063`** 로 돌린다(PR 1 이 만든 DB 가 남아 있다). 공유 postgres 컨테이너를 재생성하는 러너는 쓰지 않는다:
  ```bash
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath <파일>
  ```
  Task 1 이 마이그레이션을 만든 뒤 이 DB 에 다시 `migrate` 한다
- 알려진 base-red: `shipment-planning.integration.spec.ts` 의 묘비 박스 entrance-password 1건은 develop 에서도 빨갛다(이슈 미발행). 새 실패만 센다
- `any`·`as` 캐스팅 금지(문서화된 이유 없이). 인벤토리 쿼리는 `db.query.*`·`with` 금지 — `trx.select().from().where()` 꼴. `!` 단언 대신 찾고 없으면 던진다
- 트랜잭션: public 메서드는 `tx?: DbTx` 마지막 인자 + `this.dbService.run(fn, tx)`, private 헬퍼는 `tx: DbTx` 필수(ADR-0025)
- 오류는 이 모듈의 관례대로 `new ConflictException({ code, message, ... })` / `new BadRequestException({ code, message })`. 코드 문자열은 스펙 §7.4 표 그대로: `LINE_NOT_PHYSICAL`·`DROP_SHIP_NOT_SUPPORTED`·`LINE_BOX_NOT_DRAFT`·`COMPOSITION_NOT_FROZEN`·`COMPOSITION_UNITS_AMBIGUOUS`·`BOX_NOT_DRAFT`·`LINE_NOT_IN_FULFILLMENT`·`SALES_ORDER_CANCELLED`·`SKU_HOLDER_MISMATCH_FOR_3PL`
- 경로는 정확히 `PUT /sales-orders/:id/lines/:lineId/composition` · `GET /matchings/variants/:variantId/existing-lines-impact` · `POST /matchings/variants/:variantId/apply-to-existing-lines`. 셋 다 `AdminRealmGuard` 기본값 뒤(데코레이터 없음 — `@RequireScopes` 를 쓰면 `ScopeGuard` 도 붙여야 한다, `scripts/security/route-authz-audit.spec.ts`)
- 박스 오퍼레이션 종류는 `'amend'`(PR 1 이 enum 에 넣었다). amendment 는 `amendment_kind = 'fulfillment_only'`·`origin = 'operator'`·`status = 'applied'`·델타 `{ type: 'line_composition', salesOrderLineId, before, after, shipmentIds }`
- **FO 항목 `canceledQty` 는 고객 취소만 쓴다.** 구성 변경으로 줄어든 수량은 `qty` 를 줄인다(스펙 §6.3) — 출고 완료 판정(`shipment-dispatch.service.ts` `fullyShipped`)이 `canceledQty === 0` 을 요구하기 때문이다
- 코드 주석은 한국어로 «왜»만. 채팅 서식(화살표·굵게) 금지

## Review Focus

- **합포장 박스의 다른 라인은 그대로다** — 박스에 다른 판매주문 라인이 같이 있어도 지정한 라인의 줄만 바뀐다(`BoxTarget.salesOrderLineIds` 가 경계) → Task 6 단위 테스트 + Task 7 통합 테스트(두 라인 박스)
- **구성 변경 뒤 고객 취소가 통과한다** — 부분 취소가 있던 라인의 1개당 수량을 바꾼 뒤 부분·전체 취소, SKU 를 바꾼 뒤 전체 취소 → Task 4 통합 테스트(구성 기반 비율) + Task 8 통합 테스트(지정 뒤 취소)
- **빠진 SKU 의 FO 항목은 `qty` 0·`canceledQty` 0 으로 남고 FO 진행 계산이 던지지 않는다** — 옛 진행 계산은 qty 0 에서 400 을 던졌다 → Task 1 단위 테스트 + Task 7 통합 테스트
- **라인이 여러 박스로 나뉘어 있으면 박스마다 개수를 세어 각각 맞추고, SKU 별로 다른 박스에 갈라져 있으면 거절한다** → Task 6 단위 테스트 + Task 8 통합 테스트(분할 박스)
- **새 SKU 재고가 모자라도 거절하지 않는다** — 가능한 만큼 예약하고 박스는 draft 로 남는다(스펙 §7.3) → Task 7 통합 테스트

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` (수정) | FO 항목 CHECK `qty >= 0` |
| `apps/core/drizzle/<ts>_relax-fulfillment-order-item-qty-check.sql` (생성) | 위 변경의 마이그레이션 |
| `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts` (수정) | `FOI_QUANTITY` 가 qty 0 을 받아들인다 |
| `apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.ts` (수정) | 정합성 SQL 이 qty 0 을 받아들인다 |
| `apps/core/src/modules/fulfillment/services/fulfillment-progress.service.ts` (수정) | 진행 계산이 qty 0 을 받아들인다 |
| `apps/core/src/modules/fulfillment/services/shipping-profile.ts` (생성) | `compatibleShippingProfileId` — FO 생성과 amend 가 쓴다 |
| `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` (수정) | FO 생성이 위 함수를 쓴다 |
| `apps/core/src/modules/product-matching/line-composition/line-composition.ts` (수정) | `compositionFromMatching`·`sameComposition`·`compositionItemsProblem` |
| `apps/core/src/modules/product-matching/line-composition/frozen-compositions.ts` (생성) | `selectFrozenCompositions` — 리더·취소 경로·수정 경로가 쓴다 |
| `apps/core/src/modules/product-matching/line-composition/line-composition.reader.ts` (수정) | 위 함수를 쓴다 |
| `apps/core/src/modules/product-matching/line-composition/line-composition.manager.ts` (수정) | `assignByOperator`·`replaceMatchingComposition` |
| `apps/core/src/modules/sales-order/services/v2-cancellation-units.ts` (생성) | 구성 기반 취소 수량 순수 함수 |
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (수정) | `planV2Outstanding` 이 위 함수를 쓴다 |
| `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts` (수정) | `recordLineCompositionChange` |
| `apps/core/src/modules/fulfillment/services/shipment-aggregate.ts` (생성) | 박스 읽기·잠금·스냅샷·오퍼레이션 기록·가드(ShipmentPlanningService 에서 옮김) |
| `apps/core/src/modules/fulfillment/services/draft-line-shrink.ts` (생성) | 작성 중 박스 줄 감소(예약 해제·묘비 이동) — 취소와 amend 가 같이 쓴다 |
| `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (수정) | 위 두 파일로 위임 |
| `apps/core/src/modules/fulfillment/draft-box/box-target.ts` (생성) | `boxTarget`·`unitsOfLineInBox`·`diffBox` 순수 함수 |
| `apps/core/src/modules/fulfillment/draft-box/draft-box-amender.ts` (생성) | `DraftBoxAmender.amend` |
| `apps/core/src/modules/fulfillment/draft-box/__support__/draft-box-fixtures.ts` (생성) | 통합 스펙 픽스처(판매주문 → FO → draft 박스) |
| `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.types.ts` (생성) | 결과 타입·분류 순수 함수 |
| `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.reader.ts` (생성) | 수정 경로의 조회 + 일괄 적용 미리보기 |
| `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts` (생성) | 주문별 지정·일괄 적용 |
| `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.service.ts` (생성) | 컨트롤러가 부르는 얇은 포트 |
| `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.dto.ts` (생성) | 요청·응답 DTO |
| `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.controller.ts` (생성) | 컨트롤러 둘 |
| `apps/core/src/modules/fulfillment/line-composition-edit/__support__/line-composition-edit-wiring.ts` (생성) | 통합 스펙 배선 |
| `apps/core/src/modules/fulfillment/fulfillment.module.ts` (수정) | 등록 |

---

### Task 1: FO 항목 qty 0 허용

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:2728`
- Create: `apps/core/drizzle/<timestamp>_relax-fulfillment-order-item-qty-check.sql` (생성기가 만든다)
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts:145`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.ts:95`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-progress.service.ts:61-63`
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-progress.service.spec.ts`, `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`, `apps/core/src/modules/fulfillment/services/fulfillment-order-item-qty-zero.integration.spec.ts` (생성)

**Interfaces:**
- Produces: FO 항목 `qty = 0` 이 DB·불변식·진행 계산을 통과한다. qty 0 항목의 진행 상태는 `'canceled'`, `outstandingQty` 0. Task 7 이 이걸 만든다.

- [ ] **Step 1: 작업 브랜치·워크트리 만들기**

```bash
git -C /home/pauseb/workspace/almondyoung-server fetch origin
git -C /home/pauseb/workspace/almondyoung-server worktree add .claude/worktrees/feat-1063-line-composition-pr2 -b feat/1063-line-composition-pr2 origin/develop
cd /home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1063-line-composition-pr2
npm ci
ln -s ../../../../native/warehouse-app/node_modules native/warehouse-app/node_modules 2>/dev/null || true
```

- [ ] **Step 2: 실패하는 단위 테스트 쓰기**

`fulfillment-progress.service.spec.ts` 의 `describe('fulfillment progress projection', ...)` 안 끝에 더한다:

```ts
  it('qty 0 항목(구성 변경으로 대체됨)은 미출고 0 · canceled 로 투영하고 FO 합계에 섞이지 않는다', () => {
    expect(projectFulfillmentOrderItemProgress(item({ qty: 0, activeLineQty: 0 }))).toMatchObject({
      outstandingQty: 0,
      status: 'canceled',
    });
    expect(
      projectFulfillmentOrderProgress([
        item({ id: 'foi-0', qty: 0, activeLineQty: 0 }),
        item({ id: 'foi-1', qty: 3, activeLineQty: 3 }),
      ]),
    ).toMatchObject({ status: 'created', totalQty: 3, canceledQty: 0, outstandingQty: 3 });
  });
```

`fulfillment-invariant.service.spec.ts` 의 최상위 `describe` 안 끝에 더한다(파일의 `validSnapshot()` 을 쓴다):

```ts
  it('줄이 없는 qty 0 FO 항목은 위반이 아니고, qty 0 인데 활성 줄이 있으면 ACTIVE_LINE_QUANTITY 다', () => {
    const zero = validSnapshot();
    zero.fulfillmentOrderItems.push({ id: 'foi-0', fulfillmentOrderId: 'fo-1', qty: 0, shippedQty: 0, canceledQty: 0 });
    expect(collectFulfillmentInvariantViolations(zero)).toEqual([]);

    const withLine = validSnapshot();
    withLine.fulfillmentOrderItems.push({ id: 'foi-0', fulfillmentOrderId: 'fo-1', qty: 0, shippedQty: 0, canceledQty: 0 });
    withLine.shipmentLines.push({
      id: 'line-0',
      shipmentId: 'shipment-1',
      fulfillmentOrderItemId: 'foi-0',
      skuId: 'sku-0',
      qty: 1,
      inspectedQty: 0,
    });
    expect(collectFulfillmentInvariantViolations(withLine).map((v) => [v.kind, v.resourceId])).toContainEqual([
      'ACTIVE_LINE_QUANTITY',
      'foi-0',
    ]);
  });
```

(`validSnapshot()` 이 위반 0 인 스냅샷인지 먼저 확인할 것 — 파일에 `expect(collectFulfillmentInvariantViolations(validSnapshot())).toEqual([])` 꼴 테스트가 있다. 없으면 첫 expect 가 기존 위반 때문에 빨개질 수 있으니 `toEqual([])` 대신 `.filter((v) => v.resourceId === 'foi-0')` 로 좁혀 `[]` 를 기대한다.)

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-progress.service.spec.ts apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`
Expected: FAIL — 진행 계산은 `qty must be positive` 를 던지고, 불변식은 `FOI_QUANTITY` 위반을 낸다

- [ ] **Step 4: 진행 계산·불변식·정합성 SQL 고치기**

`fulfillment-progress.service.ts` 에서 아래 세 줄을 지운다:

```ts
  if (input.qty === 0) {
    throw new BadRequestException(`FOI ${input.id} qty must be positive`);
  }
```

그 자리에 주석 한 줄:

```ts
  // qty 0 = 라인 구성 변경으로 대체된 항목(#1063 스펙 §6.3). 미출고 0 이고 canceledQty 도 0 이라 아래 규칙이 'canceled' 로 둔다.
```

`BadRequestException` 은 같은 파일의 다른 곳에서 계속 쓰므로 import 를 남긴다.

`fulfillment-invariant.service.ts:145` 의 `item.qty <= 0` 을 `item.qty < 0` 으로:

```ts
    if (item.qty < 0 || item.shippedQty < 0 || item.canceledQty < 0 || settledQty > item.qty) {
```

`fulfillment-reconciliation.service.ts:95` 의 `WHERE foi.qty <= 0 OR` 를 `WHERE foi.qty < 0 OR` 로.

- [ ] **Step 5: 단위 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-progress.service.spec.ts apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.spec.ts`
Expected: PASS

- [ ] **Step 6: 스키마 CHECK 완화와 마이그레이션 생성**

`inventory.schema.ts` 의 `fulfillmentOrderItems` extras(현재 2728 행):

```ts
    ckQtyPositive: check('ck_fulfillment_order_items_qty_positive', sql`${t.qty} > 0`),
```

를

```ts
    // #1063: 라인 구성 변경으로 SKU 가 빠지면 그 항목의 수요는 0 이 된다 — canceledQty 는 고객 취소 전용이라 qty 를 줄인다
    ckQtyNonnegative: check('ck_fulfillment_order_items_qty_nonnegative', sql`${t.qty} >= 0`),
```

로 바꾼다. 같은 파일의 다른 `ckQtyPositive`(이벤트·shipment_lines)는 건드리지 않는다.

Run: `npm run db:generate:core -- --name relax-fulfillment-order-item-qty-check`
Expected: `apps/core/drizzle/<timestamp>_relax-fulfillment-order-item-qty-check.sql` 이 생기고 내용이 아래 두 문장(순서·따옴표는 생성기 그대로)이다:

```sql
ALTER TABLE "fulfillment_order_items" DROP CONSTRAINT "ck_fulfillment_order_items_qty_positive";--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "ck_fulfillment_order_items_qty_nonnegative" CHECK ("fulfillment_order_items"."qty" >= 0);
```

다른 테이블 변경이 섞여 있으면 멈추고 원인을 찾는다(다른 브랜치의 schema 변경이 develop 에 이미 있는데 스냅샷이 안 따라온 경우 등).

- [ ] **Step 7: 스크래치 DB 에 적용하고 통합 테스트 쓰기**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx drizzle-kit migrate --config apps/core/drizzle.config.ts`
Expected: 새 마이그레이션 1건 적용, 에러 없음

Create `apps/core/src/modules/fulfillment/services/fulfillment-order-item-qty-zero.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedHolder, seedSalesOrder, seedSku, seedWarehouseWithZone } from './__support__';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('FO 항목 qty 0 (#1063 스펙 §6.3)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  async function seedFo(tx: DbTx) {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
    const [fo] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId, warehouseId, status: 'created' })
      .returning();
    return { fo, skuId, salesOrderId, lineId: lineIds[0] };
  }

  it('DB 가 qty 0 을 받고 음수는 거절하며, 불변식 검사가 qty 0 항목을 통과시킨다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { fo, skuId, salesOrderId, lineId } = await seedFo(tx);
      await tx.insert(wmsTables.fulfillmentOrderItems).values({
        fulfillmentOrderId: fo.id,
        salesOrderId,
        salesOrderLineId: lineId,
        skuId,
        qty: 0,
      });
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([fo.id], tx)).resolves.toBeUndefined();
    });
    await inRollbackTx(db, async (tx) => {
      const { fo, skuId } = await seedFo(tx);
      await expect(
        tx.insert(wmsTables.fulfillmentOrderItems).values({ fulfillmentOrderId: fo.id, skuId, qty: -1 }),
      ).rejects.toThrow(/ck_fulfillment_order_items_qty_nonnegative/);
    });
  });
});
```

- [ ] **Step 8: 통합 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/fulfillment-order-item-qty-zero.integration.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/ \
  apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-progress.service.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-progress.service.spec.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-order-item-qty-zero.integration.spec.ts
git commit -m "feat(core): FO 항목 qty 0 허용 — 구성 변경으로 빠진 SKU 를 canceledQty 없이 기록 (#1063)"
```

---

### Task 2: 배송 프로필 순수 함수

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/shipping-profile.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipping-profile.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:279-284`

**Interfaces:**
- Produces: `compatibleShippingProfileId(deliveryProfileIds: ReadonlyArray<string | null>): string | null` — Task 7 이 쓴다

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// apps/core/src/modules/fulfillment/services/shipping-profile.spec.ts
import { compatibleShippingProfileId } from './shipping-profile';

describe('compatibleShippingProfileId', () => {
  it('모든 SKU 가 같은 프로필이면 그 값', () => {
    expect(compatibleShippingProfileId(['p1', 'p1'])).toBe('p1');
  });
  it('프로필이 섞이면 NULL — 확정 단계가 막는다', () => {
    expect(compatibleShippingProfileId(['p1', 'p2'])).toBeNull();
  });
  it('하나라도 프로필이 없으면 NULL', () => {
    expect(compatibleShippingProfileId(['p1', null])).toBeNull();
  });
  it('SKU 가 없으면 NULL', () => {
    expect(compatibleShippingProfileId([])).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/services/shipping-profile.spec.ts`
Expected: FAIL — `Cannot find module './shipping-profile'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/fulfillment/services/shipping-profile.ts
/**
 * 박스의 배송 프로필 — 담긴 SKU 가 모두 같은 프로필이면 그 값, 섞이거나 하나라도 없으면 NULL(확정 단계가 막는다).
 * FO 생성과 작성 중 박스 맞추기(DraftBoxAmender)가 같은 규칙을 써야 한다 — 다르면 같은 내용의 박스가 경로에 따라 다른 프로필을 갖는다.
 */
export function compatibleShippingProfileId(deliveryProfileIds: ReadonlyArray<string | null>): string | null {
  if (deliveryProfileIds.length === 0) return null;
  const first = deliveryProfileIds[0];
  if (first === null) return null;
  return deliveryProfileIds.every((id) => id === first) ? first : null;
}
```

- [ ] **Step 4: FO 생성이 이 함수를 쓰게 하기**

`fulfillments.service.ts` 의

```ts
      const profileIds = skuRows.map((row) => row.deliveryProfileId);
      const profiles = new Set(profileIds);
      const compatibleProfileId =
        profileIds.every((profileId): profileId is string => profileId !== null) && profiles.size === 1
          ? profileIds[0]
          : null;
```

를

```ts
      const compatibleProfileId = compatibleShippingProfileId(skuRows.map((row) => row.deliveryProfileId));
```

로 바꾸고 import 를 더한다:

```ts
import { compatibleShippingProfileId } from './shipping-profile';
```

바로 아래 `shippingProfileId: compatibleProfileId ?? null,` 은 그대로 둔다.

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/services/shipping-profile.spec.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/shipping-profile.ts apps/core/src/modules/fulfillment/services/shipping-profile.spec.ts apps/core/src/modules/fulfillment/services/fulfillments.service.ts
git commit -m "refactor(core): 박스 배송 프로필 규칙을 순수 함수로 — FO 생성과 amend 가 공유 (#1063)"
```

---

### Task 3: 라인 구성 쓰기·읽기 보강

**Files:**
- Modify: `apps/core/src/modules/product-matching/line-composition/line-composition.ts`
- Create: `apps/core/src/modules/product-matching/line-composition/frozen-compositions.ts`
- Modify: `apps/core/src/modules/product-matching/line-composition/line-composition.reader.ts:41-59`
- Modify: `apps/core/src/modules/product-matching/line-composition/line-composition.manager.ts`
- Test: `apps/core/src/modules/product-matching/line-composition/line-composition.spec.ts`, `apps/core/src/modules/product-matching/line-composition/line-composition.integration.spec.ts`

**Interfaces:**
- Consumes: PR 1 의 `CompositionItem`·`MatchingFailureReason`·`resolveLineComposition`·`LineCompositionManager.freezeFromMatching`
- Produces:
  - `type MatchingComposition = { kind: 'follow'; items: CompositionItem[] } | { kind: 'void' } | { kind: 'missing'; reason: MatchingFailureReason }`
  - `compositionFromMatching(matching: MatchingForFulfillment): MatchingComposition`
  - `sameComposition(a: readonly CompositionItem[], b: readonly CompositionItem[]): boolean`
  - `compositionItemsProblem(items: readonly CompositionItem[]): string | null`
  - `sortComposition(items: readonly CompositionItem[]): CompositionItem[]` (기존 private `sortItems` 를 export 로)
  - `selectFrozenCompositions(trx: DbTx, lineIds: readonly string[]): Promise<Map<string, CompositionItem[]>>` (SKU 순 정렬)
  - `LineCompositionManager.assignByOperator(salesOrderLineId: string, items: readonly CompositionItem[], actorId: string, tx?: DbTx): Promise<void>`
  - `LineCompositionManager.replaceMatchingComposition(salesOrderLineId: string, items: readonly CompositionItem[], tx?: DbTx): Promise<void>`

- [ ] **Step 1: 실패하는 단위 테스트 쓰기**

`line-composition.spec.ts` 끝에 더한다(파일 상단 import 에 `compositionFromMatching, compositionItemsProblem, sameComposition` 을 추가):

```ts
describe('compositionFromMatching', () => {
  it('실물 링크가 있으면 follow(SKU 순, 수량 0 은 1)', () => {
    const matching = variant([
      { skuId: 'b', quantity: 2 },
      { skuId: 'a', quantity: 0 },
    ]);
    expect(compositionFromMatching(matching)).toEqual({
      kind: 'follow',
      items: [
        { skuId: 'a', qtyPerUnit: 1 },
        { skuId: 'b', qtyPerUnit: 2 },
      ],
    });
  });
  it('매칭이 없으면 missing', () => {
    expect(compositionFromMatching(null)).toEqual({ kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' });
  });
});

describe('sameComposition', () => {
  it('순서와 무관하게 같은 (SKU, 1개당 수량) 집합이면 같다', () => {
    expect(
      sameComposition(
        [
          { skuId: 'a', qtyPerUnit: 1 },
          { skuId: 'b', qtyPerUnit: 2 },
        ],
        [
          { skuId: 'b', qtyPerUnit: 2 },
          { skuId: 'a', qtyPerUnit: 1 },
        ],
      ),
    ).toBe(true);
    expect(sameComposition([{ skuId: 'a', qtyPerUnit: 1 }], [{ skuId: 'a', qtyPerUnit: 2 }])).toBe(false);
    expect(sameComposition([{ skuId: 'a', qtyPerUnit: 1 }], [])).toBe(false);
  });
});

describe('compositionItemsProblem', () => {
  it('비었거나 SKU 가 겹치거나 수량이 양의 정수가 아니면 사유를 낸다', () => {
    expect(compositionItemsProblem([])).toMatch(/empty/);
    expect(
      compositionItemsProblem([
        { skuId: 'a', qtyPerUnit: 1 },
        { skuId: 'a', qtyPerUnit: 2 },
      ]),
    ).toMatch(/duplicate/);
    expect(compositionItemsProblem([{ skuId: 'a', qtyPerUnit: 0 }])).toMatch(/positive/);
    expect(compositionItemsProblem([{ skuId: 'a', qtyPerUnit: 1.5 }])).toMatch(/positive/);
    expect(compositionItemsProblem([{ skuId: 'a', qtyPerUnit: 3 }])).toBeNull();
  });
});
```

`variant(...)` 는 이 스펙 파일 위쪽에 이미 있는 상품매칭 픽스처다.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/product-matching/line-composition/line-composition.spec.ts`
Expected: FAIL — 세 함수가 export 되지 않음

- [ ] **Step 3: 순수 함수 구현**

`line-composition.ts` 에서 `function sortItems` 를 아래로 바꾸고(이름 `sortComposition`, export), 파일 안의 `sortItems(` 호출을 `sortComposition(` 으로 바꾼다:

```ts
// 지문·비교가 순서에 흔들리지 않게 SKU 순으로 둔다
export function sortComposition(items: readonly CompositionItem[]): CompositionItem[] {
  return [...items].sort((a, b) => a.skuId.localeCompare(b.skuId));
}
```

`resolveLineComposition` 위에 더한다:

```ts
export type MatchingComposition =
  | { kind: 'follow'; items: CompositionItem[] }
  | { kind: 'void' }
  | { kind: 'missing'; reason: MatchingFailureReason };

/** 상품매칭 하나가 정하는 구성. 라인 판정과 «기존 출고에도 적용» 미리보기가 같은 규칙을 쓴다. */
export function compositionFromMatching(matching: MatchingForFulfillment): MatchingComposition {
  if (isVoidMatching(matching)) return { kind: 'void' };
  const links = physicalSkuLinks(matching);
  if (links.length > 0) {
    // 링크 수량 0·누락을 1 로 읽는 것은 옛 FO 생성(`Math.max(1, link.quantity || 1)`)과 같은 규칙이다
    return {
      kind: 'follow',
      items: sortComposition(links.map((l) => ({ skuId: l.skuId, qtyPerUnit: Math.max(1, l.quantity || 1) }))),
    };
  }
  return { kind: 'missing', reason: matchingFailureReason(matching) };
}

export function sameComposition(a: readonly CompositionItem[], b: readonly CompositionItem[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortComposition(a);
  const right = sortComposition(b);
  return left.every((item, i) => item.skuId === right[i].skuId && item.qtyPerUnit === right[i].qtyPerUnit);
}

/** 운영자가 보낸 구성의 형식 문제. 없으면 null. DTO 검증이 못 잡는 «SKU 중복»까지 본다. */
export function compositionItemsProblem(items: readonly CompositionItem[]): string | null {
  if (items.length === 0) return 'composition is empty';
  if (new Set(items.map((item) => item.skuId)).size !== items.length) return 'composition has duplicate SKUs';
  if (items.some((item) => !Number.isSafeInteger(item.qtyPerUnit) || item.qtyPerUnit <= 0)) {
    return 'qtyPerUnit must be a positive integer';
  }
  return null;
}
```

`resolveLineComposition` 의 `isVoidMatching` 부터 끝까지를 이 함수로 바꾼다:

```ts
  return compositionFromMatching(matching);
```

(`frozen` 분기의 `sortItems(frozen)` 은 `sortComposition(frozen)` 이 된다. 반환 타입 `LineCompositionResolution` 은 `MatchingComposition` 의 세 갈래를 그대로 포함하므로 타입이 맞는다.)

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/product-matching/line-composition/line-composition.spec.ts`
Expected: PASS(기존 테스트 포함)

- [ ] **Step 5: `selectFrozenCompositions` 를 떼어 리더가 쓰게 하기**

```ts
// apps/core/src/modules/product-matching/line-composition/frozen-compositions.ts
import { inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { CompositionItem, sortComposition } from './line-composition';

/**
 * 라인들의 굳힌 구성(SKU 순). 라인 판정 리더·고객 취소 경로·수정 경로가 같은 읽기를 쓴다 — 한 곳이 정렬이나 조건을 바꾸면
 * 다른 곳의 비교(sameComposition)·비율 계산이 조용히 갈린다.
 */
export async function selectFrozenCompositions(
  trx: DbTx,
  lineIds: readonly string[],
): Promise<Map<string, CompositionItem[]>> {
  if (lineIds.length === 0) return new Map();
  const table = wmsTables.salesOrderLineCompositions;
  const rows = await trx
    .select({ salesOrderLineId: table.salesOrderLineId, skuId: table.skuId, qtyPerUnit: table.qtyPerUnit })
    .from(table)
    .where(inArray(table.salesOrderLineId, [...lineIds]));
  const byLine = new Map<string, CompositionItem[]>();
  for (const row of rows) {
    const items = byLine.get(row.salesOrderLineId) ?? [];
    items.push({ skuId: row.skuId, qtyPerUnit: row.qtyPerUnit });
    byLine.set(row.salesOrderLineId, items);
  }
  for (const [lineId, items] of byLine) byLine.set(lineId, sortComposition(items));
  return byLine;
}
```

`line-composition.reader.ts` 의 `const frozenRows = await trx ... frozenByLine.set(...)` 블록(41-59 행)을

```ts
      const frozenByLine = await selectFrozenCompositions(
        trx,
        lines.map((line) => line.id),
      );
```

로 바꾸고 `import { selectFrozenCompositions } from './frozen-compositions';` 를 더한다. 더 이상 안 쓰는 `inArray`·`CompositionItem` import 는 지운다.

- [ ] **Step 6: 매니저에 실패하는 통합 테스트 쓰기**

`line-composition.integration.spec.ts` 의 `describeIfDb(...)` 안 끝에 더한다:

```ts
  it('assignByOperator 는 출처와 무관하게 구성을 갈아 끼우고 operator·지정자를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const actorId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      await w.lineCompositionManager.freezeFromMatching(
        [{ salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] }],
        tx,
      );

      await w.lineCompositionManager.assignByOperator(lineIds[0], [{ skuId: sku.b, qtyPerUnit: 3 }], actorId, tx);

      const [r] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      expect(r.resolution).toEqual({ kind: 'frozen', source: 'operator', items: [{ skuId: sku.b, qtyPerUnit: 3 }] });
      const [line] = await tx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
      expect(line.compositionSetBy).toBe(actorId);
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('replaceMatchingComposition 은 matching 라인만 바꾸고 operator·미굳힘 라인에는 던진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: randomUUID(), quantity: 1 },
          { variantId: randomUUID(), quantity: 1 },
          { variantId: randomUUID(), quantity: 1 },
        ],
      });
      await w.lineCompositionManager.freezeFromMatching(
        [{ salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] }],
        tx,
      );
      await w.lineCompositionManager.assignByOperator(lineIds[1], [{ skuId: sku.a, qtyPerUnit: 1 }], randomUUID(), tx);

      await w.lineCompositionManager.replaceMatchingComposition(lineIds[0], [{ skuId: sku.b, qtyPerUnit: 2 }], tx);
      const resolved = new Map((await w.lineCompositions.resolveForOrder(salesOrderId, tx)).map((r) => [r.line.id, r]));
      expect(resolved.get(lineIds[0])?.resolution).toEqual({
        kind: 'frozen',
        source: 'matching',
        items: [{ skuId: sku.b, qtyPerUnit: 2 }],
      });

      await expect(
        w.lineCompositionManager.replaceMatchingComposition(lineIds[1], [{ skuId: sku.b, qtyPerUnit: 1 }], tx),
      ).rejects.toThrow(/not matching-frozen/);
      await expect(
        w.lineCompositionManager.replaceMatchingComposition(lineIds[2], [{ skuId: sku.b, qtyPerUnit: 1 }], tx),
      ).rejects.toThrow(/not matching-frozen/);
    });
  });
```

- [ ] **Step 7: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/product-matching/line-composition/line-composition.integration.spec.ts`
Expected: FAIL — `assignByOperator is not a function`

- [ ] **Step 8: 매니저 구현**

`line-composition.manager.ts` 의 import 에 `compositionItemsProblem` 을 더하고(`import { CompositionItem, compositionItemsProblem } from './line-composition';`), 클래스 안 `freezeFromMatching` 아래에 더한다:

```ts
  /**
   * 운영자 지정(#1063 스펙 §7.1). 출처가 무엇이든 덮어쓴다 — «이 주문만 다르게»는 상품매칭에서 온 구성보다 우선한다.
   * 호출자가 판매주문을 잠갔다. 박스 맞추기는 호출자(LineCompositionEditManager)의 몫이다.
   */
  async assignByOperator(
    salesOrderLineId: string,
    items: readonly CompositionItem[],
    actorId: string,
    tx?: DbTx,
  ): Promise<void> {
    await this.dbService.run(async (trx) => {
      this.assertItems(salesOrderLineId, items);
      const now = new Date();
      const claimed = await trx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: 'operator', compositionSetAt: now, compositionSetBy: actorId, updatedAt: now })
        .where(eq(wmsTables.salesOrderLines.id, salesOrderLineId))
        .returning({ id: wmsTables.salesOrderLines.id });
      if (claimed.length === 0) throw new Error(`Line ${salesOrderLineId} is missing`);
      await this.replaceRows(trx, salesOrderLineId, items);
    }, tx);
  }

  /**
   * «기존 출고에도 적용»(#1063 스펙 §7.2) — 출처는 matching 그대로 두고 구성만 바꾼다. operator 라인은 일괄 적용이 건너뛰는
   * 대상이라, 여기까지 왔다면 호출자의 판정이 틀린 것이다 — 조용히 덮지 않고 던진다.
   */
  async replaceMatchingComposition(salesOrderLineId: string, items: readonly CompositionItem[], tx?: DbTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      this.assertItems(salesOrderLineId, items);
      const now = new Date();
      const claimed = await trx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSetAt: now, compositionSetBy: null, updatedAt: now })
        .where(
          and(
            eq(wmsTables.salesOrderLines.id, salesOrderLineId),
            eq(wmsTables.salesOrderLines.compositionSource, 'matching'),
          ),
        )
        .returning({ id: wmsTables.salesOrderLines.id });
      if (claimed.length === 0) throw new Error(`Line ${salesOrderLineId} is not matching-frozen`);
      await this.replaceRows(trx, salesOrderLineId, items);
    }, tx);
  }

  private assertItems(salesOrderLineId: string, items: readonly CompositionItem[]): void {
    const problem = compositionItemsProblem(items);
    if (problem) throw new Error(`Refusing composition for line ${salesOrderLineId}: ${problem}`);
  }

  private async replaceRows(trx: DbTx, salesOrderLineId: string, items: readonly CompositionItem[]): Promise<void> {
    await trx
      .delete(wmsTables.salesOrderLineCompositions)
      .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, salesOrderLineId));
    await trx.insert(wmsTables.salesOrderLineCompositions).values(
      items.map((item) => ({ salesOrderLineId, skuId: item.skuId, qtyPerUnit: item.qtyPerUnit })),
    );
  }
```

`freezeFromMatching` 의 빈 구성 검사(`entry.items.length === 0`)는 그대로 둔다(PR 1 테스트가 `/empty/` 를 기대한다).

- [ ] **Step 9: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/product-matching/line-composition/line-composition.integration.spec.ts apps/core/src/modules/product-matching/line-composition/line-resolved.parity.integration.spec.ts`
Expected: PASS

Run: `npx jest apps/core/src/modules/product-matching apps/core/src/modules/fulfillment/order-reconcile`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/core/src/modules/product-matching/line-composition/
git commit -m "feat(core): 라인 구성 운영자 지정·matching 교체 쓰기와 굳힌 구성 읽기 공유 (#1063)"
```

---

### Task 4: 고객 취소 경로가 라인 구성에서 비율을 읽는다

**Files:**
- Create: `apps/core/src/modules/sales-order/services/v2-cancellation-units.ts`
- Create: `apps/core/src/modules/sales-order/services/v2-cancellation-units.spec.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`planV2Outstanding`, 현재 1633-1781 행)
- Create: `apps/core/src/modules/sales-order/services/sales-orders.v2-cancellation-composition.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 의 `selectFrozenCompositions`, PR 1 의 `CompositionItem`
- Produces:
  - `interface LineFulfillmentItem { id: string; skuId: string; qty: number; shippedQty: number; canceledQty: number }`
  - `outstandingSalesUnits(salesOrderLineId: string, items: readonly LineFulfillmentItem[], composition: readonly CompositionItem[]): number`
  - `physicalCancellationByItem(salesOrderLineId: string, units: number, items: readonly LineFulfillmentItem[], composition: readonly CompositionItem[]): Array<{ itemId: string; qty: number }>`

- [ ] **Step 1: 실패하는 단위 테스트 쓰기**

```ts
// apps/core/src/modules/sales-order/services/v2-cancellation-units.spec.ts
import { outstandingSalesUnits, physicalCancellationByItem } from './v2-cancellation-units';

const item = (id: string, skuId: string, qty: number, shippedQty = 0, canceledQty = 0) => ({
  id,
  skuId,
  qty,
  shippedQty,
  canceledQty,
});

describe('outstandingSalesUnits', () => {
  it('구성 SKU 마다 미출고 ÷ 1개당 수량이 같으면 그 값', () => {
    expect(
      outstandingSalesUnits('l', [item('i1', 'a', 6, 0, 2), item('i2', 'b', 2)], [
        { skuId: 'a', qtyPerUnit: 2 },
        { skuId: 'b', qtyPerUnit: 1 },
      ]),
    ).toBe(2);
  });

  it('구성 밖 SKU 의 qty 0 항목(구성 변경으로 대체됨)은 무시한다', () => {
    expect(outstandingSalesUnits('l', [item('i1', 'a', 0), item('i2', 'b', 6)], [{ skuId: 'b', qtyPerUnit: 2 }])).toBe(
      3,
    );
  });

  it('FO 생성 전 부분 취소로 FO 항목 수량이 주문 수량의 배수가 아니어도 된다', () => {
    // 주문 3, FO 전 1 취소 → FO 항목 2. 옛 역산(2 % 3)은 여기서 409 였다
    expect(outstandingSalesUnits('l', [item('i1', 'a', 2)], [{ skuId: 'a', qtyPerUnit: 1 }])).toBe(2);
  });

  it('SKU 마다 단위가 다르거나 나눠떨어지지 않으면 409', () => {
    expect(() =>
      outstandingSalesUnits('l', [item('i1', 'a', 2), item('i2', 'b', 1)], [
        { skuId: 'a', qtyPerUnit: 1 },
        { skuId: 'b', qtyPerUnit: 1 },
      ]),
    ).toThrow(/inconsistent/);
    expect(() => outstandingSalesUnits('l', [item('i1', 'a', 3)], [{ skuId: 'a', qtyPerUnit: 2 }])).toThrow(
      /not aligned/,
    );
  });

  it('구성 밖 SKU 에 미출고가 남아 있거나 구성이 비었으면 409', () => {
    expect(() => outstandingSalesUnits('l', [item('i1', 'a', 1)], [{ skuId: 'b', qtyPerUnit: 1 }])).toThrow(
      /outside the composition/,
    );
    expect(() => outstandingSalesUnits('l', [item('i1', 'a', 1)], [])).toThrow(/not frozen/);
  });
});

describe('physicalCancellationByItem', () => {
  it('판매 단위 × 1개당 수량을 그 SKU 의 항목들에서 id 순으로 미출고만큼 뺀다', () => {
    expect(
      physicalCancellationByItem('l', 2, [item('i2', 'a', 3, 0, 2), item('i1', 'a', 3)], [{ skuId: 'a', qtyPerUnit: 2 }]),
    ).toEqual([
      { itemId: 'i1', qty: 3 },
      { itemId: 'i2', qty: 1 },
    ]);
  });

  it('미출고보다 많이 취소하려 하면 400(출고·이미 취소된 수량 포함)', () => {
    expect(() => physicalCancellationByItem('l', 2, [item('i1', 'a', 2, 1)], [{ skuId: 'a', qtyPerUnit: 1 }])).toThrow(
      /includes shipped or already canceled quantity/,
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/services/v2-cancellation-units.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 순수 함수 구현**

```ts
// apps/core/src/modules/sales-order/services/v2-cancellation-units.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CompositionItem } from '../../product-matching/line-composition/line-composition';

/**
 * V2 취소의 «판매 단위 ↔ 물리 수량» 환산(#1063 스펙 §6.5). 비율은 라인의 굳힌 구성(qtyPerUnit)에서 읽는다 —
 * 옛 코드는 «FO 항목 수량 ÷ 라인 주문 수량»으로 거꾸로 셌는데, 구성을 바꾼 라인·FO 생성 전 부분 취소가 있던 라인에서
 * 그 역산이 나눠떨어지지 않아 고객 취소가 409 로 거절됐다.
 */
export interface LineFulfillmentItem {
  id: string;
  skuId: string;
  qty: number;
  shippedQty: number;
  canceledQty: number;
}

const outstandingOf = (item: LineFulfillmentItem): number => item.qty - item.shippedQty - item.canceledQty;

function itemsByCompositionSku(
  salesOrderLineId: string,
  items: readonly LineFulfillmentItem[],
  composition: readonly CompositionItem[],
): Map<string, LineFulfillmentItem[]> {
  if (composition.length === 0) {
    throw new ConflictException(`Line composition is not frozen for SalesOrder line ${salesOrderLineId}`);
  }
  const skus = new Set(composition.map((entry) => entry.skuId));
  // 구성에서 빠진 SKU 의 항목은 amend 가 qty 를 줄여 미출고 0 으로 남긴다 — 미출고가 남았다면 데이터가 어긋난 것이다
  const stray = items.find((item) => !skus.has(item.skuId) && outstandingOf(item) > 0);
  if (stray) {
    throw new ConflictException(
      `V2 fulfillment item ${stray.id} is outside the composition of SalesOrder line ${salesOrderLineId}`,
    );
  }
  const bySku = new Map<string, LineFulfillmentItem[]>();
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!skus.has(item.skuId)) continue;
    bySku.set(item.skuId, [...(bySku.get(item.skuId) ?? []), item]);
  }
  return bySku;
}

/** 아직 안 나간 판매 단위. 구성 SKU 마다 같아야 한다. */
export function outstandingSalesUnits(
  salesOrderLineId: string,
  items: readonly LineFulfillmentItem[],
  composition: readonly CompositionItem[],
): number {
  const bySku = itemsByCompositionSku(salesOrderLineId, items, composition);
  const units = composition.map((entry) => {
    const outstanding = (bySku.get(entry.skuId) ?? []).reduce((total, item) => total + outstandingOf(item), 0);
    if (outstanding % entry.qtyPerUnit !== 0) {
      throw new ConflictException(`V2 progress is not aligned for SalesOrder line ${salesOrderLineId}`);
    }
    return outstanding / entry.qtyPerUnit;
  });
  if (new Set(units).size !== 1) {
    throw new ConflictException(`V2 component progress is inconsistent for SalesOrder line ${salesOrderLineId}`);
  }
  return units[0];
}

/** 판매 단위 units 를 취소할 때 FO 항목마다 뺄 물리 수량. */
export function physicalCancellationByItem(
  salesOrderLineId: string,
  units: number,
  items: readonly LineFulfillmentItem[],
  composition: readonly CompositionItem[],
): Array<{ itemId: string; qty: number }> {
  const bySku = itemsByCompositionSku(salesOrderLineId, items, composition);
  const result: Array<{ itemId: string; qty: number }> = [];
  for (const entry of composition) {
    const candidates = bySku.get(entry.skuId) ?? [];
    let remaining = units * entry.qtyPerUnit;
    const outstanding = candidates.reduce((total, item) => total + outstandingOf(item), 0);
    if (remaining > outstanding) {
      throw new BadRequestException(
        `Cancellation for SalesOrder line ${salesOrderLineId} includes shipped or already canceled quantity; use recall or return`,
      );
    }
    for (const item of candidates) {
      if (remaining === 0) break;
      const qty = Math.min(remaining, outstandingOf(item));
      if (qty === 0) continue;
      result.push({ itemId: item.id, qty });
      remaining -= qty;
    }
  }
  return result;
}
```

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order/services/v2-cancellation-units.spec.ts`
Expected: PASS

- [ ] **Step 5: `planV2Outstanding` 이 이 함수들을 쓰게 하기**

`sales-orders.service.ts` 상단 import 에 더한다:

```ts
import { selectFrozenCompositions } from '../../product-matching/line-composition/frozen-compositions';
import { outstandingSalesUnits, physicalCancellationByItem } from './v2-cancellation-units';
```

`planV2Outstanding` 의 `fulfillmentItems` select 에 `skuId: wmsTables.fulfillmentOrderItems.skuId,` 를 더하고, 그 select 바로 다음(`const prior = ...` 앞)에:

```ts
    // 비율은 굳힌 라인 구성에서 읽는다(#1063 스펙 §6.5)
    const compositions = await selectFrozenCompositions(
      tx,
      salesOrderLines.map((line) => line.id),
    );
```

전체 취소 갈래(`const requestedSalesLines = isFullCancel ? salesOrderLines.flatMap((line) => { ... })`)의 본문을

```ts
      ? salesOrderLines.flatMap((line) => {
          const items = fulfillmentItems.filter((item) => item.salesOrderLineId === line.id);
          if (items.length === 0) {
            if (line.fulfillmentKind === 'digital' || line.requiresShipping === false) return [];
            throw new ConflictException(`V2 fulfillment item is missing for SalesOrder line ${line.id}`);
          }
          return [
            {
              salesOrderLineId: line.id,
              quantity: outstandingSalesUnits(line.id, items, compositions.get(line.id) ?? []),
            },
          ];
        })
```

로 바꾼다(`ratio`·`outstandingSalesQuantities` 계산 블록이 통째로 사라진다).

부분 취소 배분 루프에서 `for (const item of requestedItems) { ... }` 블록 전체(`const originalFoiQty = item.qty;` 부터 그 for 의 닫는 `}` 까지)를 아래로 바꾼다. 행 정렬·배분은 옛 코드와 같고, 바뀐 것은 «FO 항목마다 몇 개를 뺄지»를 정하는 부분뿐이다:

```ts
      for (const { itemId, qty: physicalQty } of physicalCancellationByItem(
        salesLine.id,
        request.quantity,
        requestedItems,
        compositions.get(salesLine.id) ?? [],
      )) {
        let remainingPhysicalQty = physicalQty;
        const rows = activeRows.filter((candidate) => candidate.fulfillmentOrderItemId === itemId);
        const ordered = [...rows].sort((left, right) => {
          const leftRank = left.shipmentStatus === 'draft' ? 0 : 1;
          const rightRank = right.shipmentStatus === 'draft' ? 0 : 1;
          return (
            leftRank - rightRank ||
            left.shipmentId.localeCompare(right.shipmentId) ||
            left.shipmentLineId.localeCompare(right.shipmentLineId)
          );
        });
        for (const row of ordered) {
          if (remainingPhysicalQty === 0) break;
          const qty = Math.min(remainingPhysicalQty, row.lineQty);
          const group = cancellationByShipment.get(row.shipmentId) ?? {
            manifestVersion: row.manifestVersion,
            lines: [],
          };
          group.lines.push({ shipmentLineId: row.shipmentLineId, expectedLineVersion: row.lineVersion, qty });
          cancellationByShipment.set(row.shipmentId, group);
          remainingPhysicalQty -= qty;
        }
        if (remainingPhysicalQty > 0) {
          throw new ConflictException(
            `V2 outstanding line quantity is short by ${remainingPhysicalQty} for fulfillment item ${itemId}`,
          );
        }
      }
```

바꾸기 전에 옛 블록의 행 정렬·배분 부분이 위와 글자 그대로 같은지 대조한다(다르면 옛 쪽을 따른다 — 이 태스크는 비율만 바꾼다).

`Cannot derive V2 cancellation ratio` 문구는 이 파일에서 사라져야 한다:

Run: `grep -n "derive V2 cancellation ratio\|item.qty % \|% salesLine.quantity" apps/core/src/modules/sales-order/services/sales-orders.service.ts`
Expected: 출력 없음

- [ ] **Step 6: 통합 테스트 쓰기**

```ts
// apps/core/src/modules/sales-order/services/sales-orders.v2-cancellation-composition.integration.spec.ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  receiveStock,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { PoliciesService } from './policies.service';
import { SalesOrdersService } from './sales-orders.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    new PoliciesService(dbService),
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  return { logistics, salesOrders };
}

/** 라인 하나(주문 수량 quantity), 매칭 SKU 하나 × qtyPerUnit, 재고 넉넉. withFo=false 면 FO 를 만들지 않는다. */
async function seedOrder(tx: DbTx, w: ReturnType<typeof wire>, quantity: number, qtyPerUnit: number) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
  const variantId = randomUUID();
  await seedMatching(tx, { variantId, skuId, quantity: qtyPerUnit });
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
  await tx.update(wmsTables.salesOrders).set({ shippingAddress: ADDRESS }).where(eq(wmsTables.salesOrders.id, salesOrderId));
  return { salesOrderId, lineId: lineIds[0], warehouseId, skuId };
}

async function itemOf(tx: DbTx, salesOrderId: string, skuId: string) {
  const [row] = await tx
    .select({ qty: wmsTables.fulfillmentOrderItems.qty, canceledQty: wmsTables.fulfillmentOrderItems.canceledQty })
    .from(wmsTables.fulfillmentOrderItems)
    .where(
      and(eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId), eq(wmsTables.fulfillmentOrderItems.skuId, skuId)),
    );
  return row;
}

describeIfDb('V2 취소 — 비율은 라인 구성에서 (#1063 스펙 §6.5)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('1개당 2 인 라인: 부분 취소 1 → 물리 2, 이어서 전체 취소가 남은 물리 4 를 취소한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 3, 2);
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver', metadata: { sourceEventId: `p-${randomUUID()}` } },
        tx,
      );
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 6, canceledQty: 2 });

      await w.salesOrders.cancel(o.salesOrderId, { cancelledBy: 'naver', metadata: { sourceEventId: `f-${randomUUID()}` } }, tx);
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 6, canceledQty: 6 });
    });
  });

  it('FO 생성 전 부분 취소가 있던 라인도 뒤이은 부분 취소가 통과한다(옛 역산은 409)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 3, 1);
      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver', metadata: { sourceEventId: `p-${randomUUID()}` } },
        tx,
      );
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 2, canceledQty: 0 });

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver', metadata: { sourceEventId: `q-${randomUUID()}` } },
        tx,
      );
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 2, canceledQty: 1 });
    });
  });
});
```

`SalesOrdersService` 생성자 인자 순서는 `channel-order-change.integration.spec.ts:35-48` 과 같다 — 실행 전에 그 파일과 대조한다(인자 수가 바뀌었으면 그쪽을 따른다).

- [ ] **Step 7: 통과 확인(새 스펙 + 취소를 타는 기존 통합 스펙)**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand \
  apps/core/src/modules/sales-order/services/sales-orders.v2-cancellation-composition.integration.spec.ts \
  apps/core/src/modules/sales-order/channel-order-change \
  apps/core/src/modules/sales-order/channel-cancel-request
```

Expected: PASS(새 실패 0). 두 번째 테스트가 옛 코드에서 409 였는지 확인하고 싶으면 Step 5 를 `git stash` 한 상태로 한 번 돌려 본다(선택)

Run: `npx jest apps/core/src/modules/sales-order`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/sales-order/services/v2-cancellation-units.ts \
  apps/core/src/modules/sales-order/services/v2-cancellation-units.spec.ts \
  apps/core/src/modules/sales-order/services/sales-orders.service.ts \
  apps/core/src/modules/sales-order/services/sales-orders.v2-cancellation-composition.integration.spec.ts
git commit -m "fix(core): V2 취소 비율을 라인 구성에서 읽는다 — 구성 변경·FO 전 부분 취소 라인의 409 (#1063)"
```

---

### Task 5: 박스 집계 헬퍼와 감소 로직 추출 (동작 불변)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/shipment-aggregate.ts`
- Create: `apps/core/src/modules/fulfillment/services/draft-line-shrink.ts`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (타입 35-65, `confirmedReservationReleaseForCancellation` 96-102, `applyDraftCancellation` 1182-1286, private 헬퍼 1288-1503)
- Test: 기존 `shipment-planning.service.spec.ts`·`shipment-planning.integration.spec.ts`·`outbound-v2-*.integration.spec.ts`·`consolidation.integration.spec.ts`

**Interfaces:**
- Produces (Task 7 이 쓴다):
  - 타입 `ShipmentRow`·`ShipmentLineRow`·`ShipmentAggregate`·`ShipmentManifestSnapshot`·`ShipmentOperationMember = { shipmentId: string; role: 'source' | 'target'; before: ShipmentManifestSnapshot | null; after: ShipmentManifestSnapshot }`
  - `loadShipmentAggregate(tx: DbTx, shipmentId: string): Promise<ShipmentAggregate>`
  - `lockShipmentAggregate(tx: DbTx, invariant: FulfillmentInvariantService, shipmentId: string): Promise<ShipmentAggregate>`
  - `shipmentSnapshot(aggregate: ShipmentAggregate): ShipmentManifestSnapshot`
  - `createShipmentOperation(tx: DbTx, input: { type: ShipmentOperationType; actorId: string; reason: string; csCaseId: string | null; note: string | null; idempotencyKey: string; requestHash: string; before: ShipmentManifestSnapshot })` → 오퍼레이션 행
  - `completeShipmentOperation(tx: DbTx, operationId: string, members: ShipmentOperationMember[]): Promise<void>`
  - `selectConfirmedReservationQtyByLine(tx: DbTx, lineIds: string[]): Promise<Map<string, number>>`
  - `assertShipmentHasNoActiveWaybill(tx: DbTx, shipmentId: string): Promise<void>` — 코드 `SHIPMENT_ACTIVE_INVOICE`
  - `assertShipmentHasNoCustodyOrActiveWork(tx: DbTx, aggregate: ShipmentAggregate): Promise<void>` — 코드 `SHIPMENT_CUSTODY_EXISTS`·`SHIPMENT_ACTIVE_WORK_ITEM`
  - `confirmedReservationReleaseForCancellation(lineQty, confirmedQty, cancelQty): number` (draft-line-shrink 로 옮기고 planning 에서 re-export)
  - `shrinkDraftLines(reservations: ShipmentReservationService, input: { shipment: ShipmentRow; lines: ReadonlyArray<{ line: ShipmentLineRow; qty: number }>; reason: string; actorId: string; wholeShipment: boolean }, tx: DbTx): Promise<{ tombstone: ShipmentRow | null }>`

이 태스크는 **동작을 바꾸지 않는다.** 새 테스트 대신 기존 스펙 전부가 안전망이다.

- [ ] **Step 1: 기준선 — 지금 통과하는 것을 기록**

```bash
npx jest apps/core/src/modules/fulfillment/services/shipment-planning.service.spec.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand \
  apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/outbound-v2-scenarios.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/outbound-v2-lifecycle-scenarios.integration.spec.ts \
  apps/core/src/modules/sales-order/channel-order-change 2>&1 | tail -40 > /tmp/claude-1000/-home-pauseb-workspace-almondyoung-server/4fdd2ebf-71af-4cee-867d-7e06638a98e9/scratchpad/task5-baseline.txt
```

실패 목록을 적어 둔다(알려진 base-red: 묘비 박스 entrance-password 1건). Step 6 에서 같은 목록이어야 한다.

- [ ] **Step 2: `shipment-aggregate.ts` 만들기**

```ts
// apps/core/src/modules/fulfillment/services/shipment-aggregate.ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, ne, notInArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { ACTIVE_WORK_ITEM_STATUSES } from './work-item-status';

/**
 * 박스 하나와 그 줄을 읽고·잠그고·기록하는 공용 조각. 분할·취소(ShipmentPlanningService)와 작성 중 박스 맞추기
 * (DraftBoxAmender)가 같이 쓴다 — 가드나 스냅샷 모양이 두 벌이면 한쪽만 고쳐진다.
 */
export type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
export type ShipmentLineRow = typeof wmsTables.shipmentLines.$inferSelect & {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  fulfillmentMode: string | null;
};
export type ShipmentAggregate = {
  shipment: ShipmentRow;
  lines: ShipmentLineRow[];
  fulfillmentOrderIds: string[];
};
export type ShipmentManifestSnapshot = {
  shipmentId: string;
  status: string;
  warehouseId: string;
  shippingProfileId: string | null;
  recipientSnapshot: unknown;
  manifestVersion: number;
  reservationVersion: number;
  lines: Array<{
    id: string;
    fulfillmentOrderItemId: string;
    skuId: string;
    qty: number;
    reservedQty: number;
    inspectedQty: number;
    lineVersion: number;
  }>;
};
export type ShipmentOperationType = (typeof wmsTables.shipmentOperations.type.enumValues)[number];
export type ShipmentOperationMember = {
  shipmentId: string;
  role: 'source' | 'target';
  before: ShipmentManifestSnapshot | null;
  after: ShipmentManifestSnapshot;
};

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
```

그 아래에 `ShipmentPlanningService` 의 private 메서드 본문을 **그대로** 옮겨 함수로 만든다. 바뀌는 것은 시그니처(`tx` 가 첫 인자)와 `this.` 참조뿐이다:

| 옮길 메서드(현재 행) | 새 함수 |
| --- | --- |
| `loadAggregate`(1301-1339) | `export async function loadShipmentAggregate(tx: DbTx, shipmentId: string): Promise<ShipmentAggregate>` |
| `lockAggregate`(1288-1299) | `export async function lockShipmentAggregate(tx: DbTx, invariant: FulfillmentInvariantService, shipmentId: string): Promise<ShipmentAggregate>` — 본문의 `this.loadAggregate(shipmentId, tx)` → `loadShipmentAggregate(tx, shipmentId)`, `this.invariant` → `invariant`, `this.conflict` → `conflict` |
| `snapshot`(1341-1360) | `export function shipmentSnapshot(aggregate: ShipmentAggregate): ShipmentManifestSnapshot` |
| `createOperation`(1362-1388) | 아래 코드 |
| `completeOperation`(1390-1419) | `export async function completeShipmentOperation(tx: DbTx, operationId: string, members: ShipmentOperationMember[]): Promise<void>` |
| `confirmedReservationQtyByLine`(1439-1456) | `export async function selectConfirmedReservationQtyByLine(tx: DbTx, lineIds: string[]): Promise<Map<string, number>>` |
| `assertNoActiveWaybill`(1458-1470) | `export async function assertShipmentHasNoActiveWaybill(tx: DbTx, shipmentId: string): Promise<void>` |
| `assertNoCustodyOrActiveWork`(1472-1503) | `export async function assertShipmentHasNoCustodyOrActiveWork(tx: DbTx, aggregate: ShipmentAggregate): Promise<void>` |

`createShipmentOperation` 은 인자를 객체로 받는다:

```ts
export async function createShipmentOperation(
  tx: DbTx,
  input: {
    type: ShipmentOperationType;
    actorId: string;
    reason: string;
    csCaseId: string | null;
    note: string | null;
    idempotencyKey: string;
    requestHash: string;
    before: ShipmentManifestSnapshot;
  },
) {
  const [operation] = await tx
    .insert(wmsTables.shipmentOperations)
    .values({
      type: input.type,
      status: 'pending',
      operatorId: input.actorId,
      reason: input.reason,
      csCaseId: input.csCaseId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      beforeManifestSnapshot: input.before,
    })
    .returning();
  return operation;
}
```

- [ ] **Step 3: `draft-line-shrink.ts` 만들기**

```ts
// apps/core/src/modules/fulfillment/services/draft-line-shrink.ts
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { selectConfirmedReservationQtyByLine, ShipmentLineRow, ShipmentRow } from './shipment-aggregate';
import type { ShipmentReservationService } from './shipment-reservation.service';

export function confirmedReservationReleaseForCancellation(
  lineQty: number,
  confirmedQty: number,
  cancelQty: number,
): number {
  return Math.max(0, cancelQty - (lineQty - confirmedQty));
}

/**
 * 작성 중 박스의 줄을 줄인다 — 남는 줄 수량을 넘는 확정 예약만 먼저 놓고, 줄을 줄이거나 통째로 빠지는 줄은 묘비 박스로
 * 옮긴다(줄 수량 0 은 CHECK 가 막는다). FO 항목은 건드리지 않는다: 고객 취소는 canceledQty 를, 구성 변경은 qty 를 줄이고
 * 그 차이가 «고객 취소»로 읽히느냐를 가른다(#1063 스펙 §6.3). 박스 상태·manifestVersion·recompute 도 호출자 몫이다.
 * 예약 해제(releasePartial)가 불변식을 검사하므로 줄·FO 항목을 바꾸기 전에 끝낸다.
 */
export async function shrinkDraftLines(
  reservations: ShipmentReservationService,
  input: {
    shipment: ShipmentRow;
    lines: ReadonlyArray<{ line: ShipmentLineRow; qty: number }>;
    reason: string;
    actorId: string;
    wholeShipment: boolean;
  },
  tx: DbTx,
): Promise<{ tombstone: ShipmentRow | null }> {
  const confirmed = await selectConfirmedReservationQtyByLine(
    tx,
    input.lines.map((entry) => entry.line.id),
  );
  for (const { line, qty } of input.lines) {
    const releaseQty = confirmedReservationReleaseForCancellation(line.qty, confirmed.get(line.id) ?? 0, qty);
    if (releaseQty > 0) await reservations.releasePartial(line.id, releaseQty, input.reason, tx);
  }
  // 박스 전체를 비우는 취소는 줄을 옮기지 않고 박스째 canceled 로 둔다(호출자가 상태를 바꾼다)
  if (input.wholeShipment) return { tombstone: null };

  let tombstone: ShipmentRow | null = null;
  if (input.lines.some(({ line, qty }) => qty === line.qty)) {
    // 묘비 상자는 **의도적으로 비번을 안 받는다.** 송장을 발행하지 않고 배송되지도 않으므로 실을 이유가 없고,
    // 실으면 배송 완료 파기가 영영 도달하지 않는 사본이 하나 더 생긴다(백스톱 배치만 남는다).
    const [created] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: input.shipment.warehouseId,
        status: 'canceled',
        shippingProfileId: input.shipment.shippingProfileId,
        recipientSnapshot: input.shipment.recipientSnapshot,
        manifestVersion: 1,
        reservationVersion: 1,
        openedBy: input.actorId,
        openedAt: new Date(),
      })
      .returning();
    tombstone = created;
  }
  for (const { line, qty } of input.lines) {
    if (qty === line.qty && tombstone) {
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: tombstone.id, lineVersion: line.lineVersion + 1 })
        .where(eq(wmsTables.shipmentLines.id, line.id));
    } else {
      await tx
        .update(wmsTables.shipmentLines)
        .set({ qty: line.qty - qty, lineVersion: line.lineVersion + 1 })
        .where(eq(wmsTables.shipmentLines.id, line.id));
    }
  }
  return { tombstone };
}
```

- [ ] **Step 4: `ShipmentPlanningService` 를 위임으로 바꾸기**

1. 파일 상단 35-65 행의 `ShipmentRow`·`ShipmentLineRow`·`ShipmentAggregate`·`ShipmentManifestSnapshot` 타입 정의를 지우고 import 로 바꾼다:

```ts
import {
  assertShipmentHasNoActiveWaybill,
  assertShipmentHasNoCustodyOrActiveWork,
  completeShipmentOperation,
  createShipmentOperation,
  loadShipmentAggregate,
  lockShipmentAggregate,
  selectConfirmedReservationQtyByLine,
  shipmentSnapshot,
  ShipmentAggregate,
  ShipmentLineRow,
  ShipmentManifestSnapshot,
  ShipmentOperationMember,
  ShipmentRow,
} from './shipment-aggregate';
import { shrinkDraftLines } from './draft-line-shrink';
```

2. `export function confirmedReservationReleaseForCancellation(...)` 정의(96-102 행)를 지우고 그 자리에 re-export(기존 스펙이 이 파일에서 import 한다):

```ts
export { confirmedReservationReleaseForCancellation } from './draft-line-shrink';
```

3. private 메서드 여덟 개의 **본문만** 위임으로 바꾼다(시그니처·호출부는 그대로 — 호출부 수십 곳을 건드리지 않는다):

```ts
  private async lockAggregate(shipmentId: string, tx: DbTx): Promise<ShipmentAggregate> {
    return lockShipmentAggregate(tx, this.invariant, shipmentId);
  }

  private async loadAggregate(shipmentId: string, tx: DbTx): Promise<ShipmentAggregate> {
    return loadShipmentAggregate(tx, shipmentId);
  }

  private snapshot(aggregate: ShipmentAggregate): ShipmentManifestSnapshot {
    return shipmentSnapshot(aggregate);
  }

  private async createOperation(
    tx: DbTx,
    type: (typeof wmsTables.shipmentOperations.type.enumValues)[number],
    actor: ShipmentPlanningActor,
    reason: string,
    csCaseId: string | undefined,
    note: string | undefined,
    idempotencyKey: string,
    requestHash: string,
    before: ShipmentManifestSnapshot,
  ) {
    return createShipmentOperation(tx, {
      type,
      actorId: actor.id,
      reason,
      csCaseId: csCaseId ?? null,
      note: note ?? null,
      idempotencyKey,
      requestHash,
      before,
    });
  }

  private async completeOperation(tx: DbTx, operationId: string, members: ShipmentOperationMember[]): Promise<void> {
    await completeShipmentOperation(tx, operationId, members);
  }

  private async confirmedReservationQtyByLine(lineIds: string[], tx: DbTx): Promise<Map<string, number>> {
    return selectConfirmedReservationQtyByLine(tx, lineIds);
  }

  private async assertNoActiveWaybill(shipmentId: string, tx: DbTx): Promise<void> {
    await assertShipmentHasNoActiveWaybill(tx, shipmentId);
  }

  private async assertNoCustodyOrActiveWork(aggregate: ShipmentAggregate, tx: DbTx): Promise<void> {
    await assertShipmentHasNoCustodyOrActiveWork(tx, aggregate);
  }
```

4. `applyDraftCancellation` 에서 «예약 해제 → 묘비 생성 → 줄 이동·감소» 부분을 `shrinkDraftLines` 로 바꾼다. 바뀐 메서드 앞부분(나머지 — FO 항목 `canceledQty` 갱신부터 끝까지 — 는 그대로):

```ts
  ): Promise<void> {
    const before = operationBefore ?? this.snapshot(aggregate);
    const totalShipmentQty = aggregate.lines.reduce((total, line) => total + line.qty, 0);
    const totalCanceledQty = selected.reduce((total, entry) => total + entry.request.qty, 0);
    const cancelWholeShipment = totalShipmentQty === totalCanceledQty;
    const { tombstone } = await shrinkDraftLines(
      this.reservations,
      {
        shipment: aggregate.shipment,
        lines: selected.map(({ request, line }) => ({ line, qty: request.qty })),
        reason: dto.reason,
        actorId: actor.id,
        wholeShipment: cancelWholeShipment,
      },
      tx,
    );

    const canceledByFoi = new Map<string, number>();
    for (const { request, line } of selected) {
      canceledByFoi.set(
        line.fulfillmentOrderItemId,
        (canceledByFoi.get(line.fulfillmentOrderItemId) ?? 0) + request.qty,
      );
    }
    for (const [fulfillmentOrderItemId, canceledQty] of canceledByFoi) {
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({
          canceledQty: sql`${wmsTables.fulfillmentOrderItems.canceledQty} + ${canceledQty}`,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrderItems.id, fulfillmentOrderItemId));
    }
    // 이 아래(박스 상태·manifestVersion 갱신, recompute, 묘비 recompute, 스냅샷·completeOperation·audit)는 옛 코드 그대로
```

`tombstone!.id` 를 쓰던 곳은 사라졌다. 뒤쪽 `if (tombstone)` 두 군데는 `ShipmentRow | null` 에서도 그대로 동작한다.

5. 더 이상 안 쓰는 import(`gt`·`ne`·`notInArray`·`WAYBILL_TERMINAL_STATUSES`·`ACTIVE_WORK_ITEM_STATUSES`·`NotFoundException` 등)는 `npm run type-check`·`npm run lint` 가 알려 주는 대로만 지운다 — 다른 메서드가 아직 쓰는 것이 있다.

- [ ] **Step 5: 타입 확인**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 6: 기준선과 같은지 확인**

Step 1 의 두 명령을 다시 돌려 `task5-after.txt` 로 저장하고 실패 목록을 비교한다.
Expected: 실패 목록이 같다(새 실패 0)

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-aggregate.ts \
  apps/core/src/modules/fulfillment/services/draft-line-shrink.ts \
  apps/core/src/modules/fulfillment/services/shipment-planning.service.ts
git commit -m "refactor(core): 박스 집계·작성 중 줄 감소를 함수로 떼어 낸다 — amend 와 공유, 동작 불변 (#1063)"
```

---

### Task 6: 박스 목표 순수 함수

**Files:**
- Create: `apps/core/src/modules/fulfillment/draft-box/box-target.ts`
- Create: `apps/core/src/modules/fulfillment/draft-box/box-target.spec.ts`

**Interfaces:**
- Consumes: `CompositionItem`
- Produces (Task 7·8 이 쓴다):
  - `interface BoxTargetItem { salesOrderLineId: string; skuId: string; qty: number }`
  - `interface BoxTarget { salesOrderLineIds: readonly string[]; items: readonly BoxTargetItem[] }`
  - `interface BoxLineView { shipmentLineId: string; salesOrderLineId: string | null; skuId: string; qty: number }`
  - `interface BoxDiff { decreases: Array<{ shipmentLineId: string; qty: number }>; increases: Array<{ salesOrderLineId: string; skuId: string; qty: number; shipmentLineId: string | null }> }`
  - `boxTarget(unitsByLine: ReadonlyMap<string, number>, compositionByLine: ReadonlyMap<string, readonly CompositionItem[]>): BoxTarget`
  - `unitsOfLineInBox(salesOrderLineId: string, boxLines: readonly BoxLineView[], composition: readonly CompositionItem[]): number` — 계산 불가면 `ConflictException({ code: 'COMPOSITION_UNITS_AMBIGUOUS' })`
  - `diffBox(lines: readonly BoxLineView[], target: BoxTarget): BoxDiff`

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// apps/core/src/modules/fulfillment/draft-box/box-target.spec.ts
import { boxTarget, diffBox, unitsOfLineInBox } from './box-target';

const view = (shipmentLineId: string, salesOrderLineId: string | null, skuId: string, qty: number) => ({
  shipmentLineId,
  salesOrderLineId,
  skuId,
  qty,
});

describe('boxTarget', () => {
  it('라인별 담긴 개수 × 1개당 수량, 0 은 빼고 범위는 넘긴 라인 전부', () => {
    expect(
      boxTarget(
        new Map([
          ['L2', 0],
          ['L1', 2],
        ]),
        new Map([
          [
            'L1',
            [
              { skuId: 'b', qtyPerUnit: 1 },
              { skuId: 'a', qtyPerUnit: 3 },
            ],
          ],
          ['L2', [{ skuId: 'c', qtyPerUnit: 1 }]],
        ]),
      ),
    ).toEqual({
      salesOrderLineIds: ['L1', 'L2'],
      items: [
        { salesOrderLineId: 'L1', skuId: 'a', qty: 6 },
        { salesOrderLineId: 'L1', skuId: 'b', qty: 2 },
      ],
    });
  });
});

describe('unitsOfLineInBox', () => {
  const composition = [
    { skuId: 'a', qtyPerUnit: 2 },
    { skuId: 'b', qtyPerUnit: 1 },
  ];
  it('SKU 마다 같은 개수가 나오면 그 값, 라인이 없으면 0', () => {
    expect(unitsOfLineInBox('L1', [view('s1', 'L1', 'a', 4), view('s2', 'L1', 'b', 2), view('s3', 'L9', 'a', 7)], composition)).toBe(2);
    expect(unitsOfLineInBox('L1', [view('s3', 'L9', 'a', 7)], composition)).toBe(0);
  });
  it('SKU 별로 다른 박스에 갈라졌거나 나눠떨어지지 않거나 구성 밖 SKU 가 있으면 COMPOSITION_UNITS_AMBIGUOUS', () => {
    for (const lines of [
      [view('s1', 'L1', 'a', 4)],
      [view('s1', 'L1', 'a', 3), view('s2', 'L1', 'b', 2)],
      [view('s1', 'L1', 'a', 4), view('s2', 'L1', 'b', 2), view('s4', 'L1', 'z', 1)],
    ]) {
      expect(() => unitsOfLineInBox('L1', lines, composition)).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'COMPOSITION_UNITS_AMBIGUOUS' }) }),
      );
    }
  });
});

describe('diffBox', () => {
  it('범위 밖 라인(합포장의 다른 주문)은 건드리지 않는다', () => {
    const diff = diffBox([view('s1', 'L1', 'a', 2), view('s9', 'OTHER', 'a', 5)], {
      salesOrderLineIds: ['L1'],
      items: [{ salesOrderLineId: 'L1', skuId: 'a', qty: 2 }],
    });
    expect(diff).toEqual({ decreases: [], increases: [] });
  });

  it('SKU 교체: 옛 줄은 통째로 줄이고 새 (라인, SKU) 는 줄 없이 늘린다', () => {
    expect(
      diffBox([view('s1', 'L1', 'a', 2)], {
        salesOrderLineIds: ['L1'],
        items: [{ salesOrderLineId: 'L1', skuId: 'b', qty: 4 }],
      }),
    ).toEqual({
      decreases: [{ shipmentLineId: 's1', qty: 2 }],
      increases: [{ salesOrderLineId: 'L1', skuId: 'b', qty: 4, shipmentLineId: null }],
    });
  });

  it('같은 (라인, SKU) 의 증감은 첫 줄에서 — 감소는 줄 id 순으로 나눠 뺀다', () => {
    expect(
      diffBox([view('s2', 'L1', 'a', 1), view('s1', 'L1', 'a', 2)], {
        salesOrderLineIds: ['L1'],
        items: [{ salesOrderLineId: 'L1', skuId: 'a', qty: 5 }],
      }),
    ).toEqual({ decreases: [], increases: [{ salesOrderLineId: 'L1', skuId: 'a', qty: 2, shipmentLineId: 's1' }] });
    expect(
      diffBox([view('s2', 'L1', 'a', 1), view('s1', 'L1', 'a', 2)], {
        salesOrderLineIds: ['L1'],
        items: [],
      }),
    ).toEqual({
      decreases: [
        { shipmentLineId: 's1', qty: 2 },
        { shipmentLineId: 's2', qty: 1 },
      ],
      increases: [],
    });
  });

  it('목표가 범위 밖 라인을 가리키거나 같은 (라인, SKU) 가 두 번이면 던진다(호출자 결함)', () => {
    expect(() =>
      diffBox([], { salesOrderLineIds: ['L1'], items: [{ salesOrderLineId: 'L2', skuId: 'a', qty: 1 }] }),
    ).toThrow(/outside/);
    expect(() =>
      diffBox([], {
        salesOrderLineIds: ['L1'],
        items: [
          { salesOrderLineId: 'L1', skuId: 'a', qty: 1 },
          { salesOrderLineId: 'L1', skuId: 'a', qty: 2 },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/draft-box/box-target.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/fulfillment/draft-box/box-target.ts
import { ConflictException } from '@nestjs/common';
import { CompositionItem, sortComposition } from '../../product-matching/line-composition/line-composition';

/**
 * «박스에 무엇이 들어가야 하나»의 유일한 정의(#1063 스펙 §6.1). 박스 목표 = 라인별 담긴 개수 × 라인 구성.
 * 라인 구성 변경은 구성을, S2(주문 수정 전파)는 개수를 바꿔 같은 함수를 부른다 — 둘이 따로 계산하면 S2 가 상품매칭으로
 * 되돌아가 운영자 지정을 조용히 지운다.
 */
export interface BoxTargetItem {
  salesOrderLineId: string;
  skuId: string;
  qty: number;
}

/** salesOrderLineIds 밖의 박스 줄은 건드리지 않는다 — 합포장 박스의 다른 주문 라인을 지키는 경계다. */
export interface BoxTarget {
  salesOrderLineIds: readonly string[];
  items: readonly BoxTargetItem[];
}

export interface BoxLineView {
  shipmentLineId: string;
  salesOrderLineId: string | null;
  skuId: string;
  qty: number;
}

export interface BoxDiff {
  decreases: Array<{ shipmentLineId: string; qty: number }>;
  increases: Array<{ salesOrderLineId: string; skuId: string; qty: number; shipmentLineId: string | null }>;
}

export function boxTarget(
  unitsByLine: ReadonlyMap<string, number>,
  compositionByLine: ReadonlyMap<string, readonly CompositionItem[]>,
): BoxTarget {
  const salesOrderLineIds = [...unitsByLine.keys()].sort();
  const items: BoxTargetItem[] = [];
  for (const salesOrderLineId of salesOrderLineIds) {
    const units = unitsByLine.get(salesOrderLineId) ?? 0;
    if (units === 0) continue;
    const composition = compositionByLine.get(salesOrderLineId);
    if (!composition || composition.length === 0) throw new Error(`No composition for line ${salesOrderLineId}`);
    for (const entry of sortComposition(composition)) {
      items.push({ salesOrderLineId, skuId: entry.skuId, qty: units * entry.qtyPerUnit });
    }
  }
  return { salesOrderLineIds, items };
}

/**
 * 박스에 담긴 그 라인의 판매 개수(#1063 스펙 §6.2) = 그 라인 SKU 줄 수량 ÷ 옛 구성의 1개당 수량. 옛 구성 SKU 마다 같은 값이
 * 나와야 한다 — 분할로 SKU 가 다른 박스에 갈라졌으면 «이 박스에 몇 개»가 정의되지 않으므로 거절한다.
 */
export function unitsOfLineInBox(
  salesOrderLineId: string,
  boxLines: readonly BoxLineView[],
  composition: readonly CompositionItem[],
): number {
  const qtyBySku = new Map<string, number>();
  for (const line of boxLines) {
    if (line.salesOrderLineId !== salesOrderLineId) continue;
    qtyBySku.set(line.skuId, (qtyBySku.get(line.skuId) ?? 0) + line.qty);
  }
  if (qtyBySku.size === 0) return 0;
  const ambiguous = () =>
    new ConflictException({
      code: 'COMPOSITION_UNITS_AMBIGUOUS',
      message: `Cannot derive how many units of line ${salesOrderLineId} the box holds`,
      salesOrderLineId,
    });
  const known = new Set(composition.map((entry) => entry.skuId));
  if ([...qtyBySku.keys()].some((skuId) => !known.has(skuId))) throw ambiguous();
  const units = composition.map((entry) => {
    const qty = qtyBySku.get(entry.skuId) ?? 0;
    if (qty % entry.qtyPerUnit !== 0) throw ambiguous();
    return qty / entry.qtyPerUnit;
  });
  if (composition.length === 0 || new Set(units).size !== 1) throw ambiguous();
  return units[0];
}

/** 박스 줄과 목표를 (라인, SKU) 로 비교한다. 늘림은 그 (라인, SKU) 의 첫 줄(id 순)에, 줄임은 줄 id 순으로 나눠 뺀다. */
export function diffBox(lines: readonly BoxLineView[], target: BoxTarget): BoxDiff {
  const scope = new Set(target.salesOrderLineIds);
  const key = (salesOrderLineId: string, skuId: string) => `${salesOrderLineId}\u0000${skuId}`;

  const current = new Map<string, { salesOrderLineId: string; skuId: string; lines: BoxLineView[] }>();
  for (const line of [...lines].sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId))) {
    if (line.salesOrderLineId === null || !scope.has(line.salesOrderLineId)) continue;
    const k = key(line.salesOrderLineId, line.skuId);
    const group = current.get(k) ?? { salesOrderLineId: line.salesOrderLineId, skuId: line.skuId, lines: [] };
    group.lines.push(line);
    current.set(k, group);
  }

  const wanted = new Map<string, BoxTargetItem>();
  for (const item of target.items) {
    if (!scope.has(item.salesOrderLineId)) {
      throw new Error(`Target item for line ${item.salesOrderLineId} is outside the target scope`);
    }
    const k = key(item.salesOrderLineId, item.skuId);
    if (wanted.has(k)) throw new Error(`Target has duplicate (line, SKU) ${item.salesOrderLineId}/${item.skuId}`);
    wanted.set(k, item);
  }

  const diff: BoxDiff = { decreases: [], increases: [] };
  for (const [k, group] of current) {
    const have = group.lines.reduce((total, line) => total + line.qty, 0);
    const want = wanted.get(k)?.qty ?? 0;
    if (want > have) {
      diff.increases.push({
        salesOrderLineId: group.salesOrderLineId,
        skuId: group.skuId,
        qty: want - have,
        shipmentLineId: group.lines[0].shipmentLineId,
      });
    }
    let rest = have - want;
    for (const line of group.lines) {
      if (rest <= 0) break;
      const qty = Math.min(rest, line.qty);
      diff.decreases.push({ shipmentLineId: line.shipmentLineId, qty });
      rest -= qty;
    }
  }
  for (const [k, item] of wanted) {
    if (current.has(k) || item.qty === 0) continue;
    diff.increases.push({ salesOrderLineId: item.salesOrderLineId, skuId: item.skuId, qty: item.qty, shipmentLineId: null });
  }
  diff.decreases.sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId));
  diff.increases.sort((a, b) => key(a.salesOrderLineId, a.skuId).localeCompare(key(b.salesOrderLineId, b.skuId)));
  return diff;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/draft-box/box-target.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/draft-box/box-target.ts apps/core/src/modules/fulfillment/draft-box/box-target.spec.ts
git commit -m "feat(core): 박스 목표·담긴 개수·박스 비교 순수 함수 — S2 와 공유 (#1063)"
```

---

### Task 7: DraftBoxAmender

**Files:**
- Create: `apps/core/src/modules/fulfillment/draft-box/draft-box-amender.ts`
- Create: `apps/core/src/modules/fulfillment/draft-box/__support__/draft-box-fixtures.ts`
- Create: `apps/core/src/modules/fulfillment/draft-box/draft-box-amender.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1(qty 0), Task 2 `compatibleShippingProfileId`, Task 5 집계 헬퍼·`shrinkDraftLines`, Task 6 `BoxTarget`·`diffBox`, `ShipmentReservationService.reservePartial/recompute`, `acquireStockAvailabilityLocks`, `canonicalFulfillmentRequestHash`
- Produces:
  - `class DraftBoxAmender { constructor(dbService: DbService<typeof wmsSchema>, reservations: ShipmentReservationService, invariant: FulfillmentInvariantService, audit: AuditService) }`
  - `amend(shipmentId: string, target: BoxTarget, reason: string, actor: { id: string }, tx?: DbTx): Promise<AmendResult>`
  - `interface AmendResult { changed: boolean; operationId: string | null; manifestVersion: number; tombstoneShipmentId: string | null }`
  - 픽스처 `seedOrderWithDraftBox(tx, logistics, args)` → `DraftBoxFixture`(Task 8·9 도 쓴다)

- [ ] **Step 1: 픽스처 만들기**

```ts
// apps/core/src/modules/fulfillment/draft-box/__support__/draft-box-fixtures.ts
import { randomUUID } from 'crypto';
import { asc, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { seedHolder, seedSalesOrder, seedSku, seedWarehouseWithZone, Wired } from '../../services/__support__';

export interface DraftBoxFixture {
  warehouseId: string;
  locationId: string;
  holderId: string;
  salesOrderId: string;
  lineIds: string[];
  variantIds: string[];
  /** 라인마다 매칭 링크 SKU(넘긴 qtyPerUnits 순) */
  skuIdsByLine: string[][];
  /** 아직 아무 데도 안 쓴 SKU — 교체 대상 */
  spareSkuIds: string[];
  fulfillmentOrderId: string;
  shipmentId: string;
}

/** SKU 하나 + 그 창고 ON_HAND 재고(onHand 0 이면 재고 없음). */
export async function seedStockedSku(
  tx: DbTx,
  at: { warehouseId: string; locationId: string; holderId: string },
  onHand: number,
): Promise<string> {
  const { skuId } = await seedSku(tx, at.holderId);
  if (onHand > 0) {
    await tx.insert(wmsTables.stockLedgers).values({
      skuId,
      warehouseId: at.warehouseId,
      locationId: at.locationId,
      stockState: 'ON_HAND',
      qty: onHand,
    });
  }
  return skuId;
}

/** 판매주문(라인마다 매칭 SKU × qtyPerUnits) → FO → draft 박스 하나. 재고는 SKU 마다 onHand(기본 100). */
export async function seedOrderWithDraftBox(
  tx: DbTx,
  logistics: Wired,
  args: { lines: Array<{ quantity: number; qtyPerUnits: number[] }>; onHand?: number; spareSkus?: number },
): Promise<DraftBoxFixture> {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const at = { warehouseId, locationId, holderId };
  const onHand = args.onHand ?? 100;
  const variantIds = args.lines.map(() => randomUUID());
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
    lines: args.lines.map((line, i) => ({ variantId: variantIds[i], quantity: line.quantity })),
  });
  await tx
    .update(wmsTables.salesOrders)
    .set({
      shippingAddress: {
        recipientName: 'IT',
        phone: '010-0000-0000',
        postalCode: '01234',
        roadAddress: 'Seoul',
        detailAddress: '101',
      },
    })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));

  const skuIdsByLine: string[][] = [];
  for (const [i, line] of args.lines.entries()) {
    const skuIds: string[] = [];
    for (let k = 0; k < line.qtyPerUnits.length; k += 1) skuIds.push(await seedStockedSku(tx, at, onHand));
    const [matching] = await tx
      .insert(wmsTables.productMatchings)
      .values({ variantId: variantIds[i], status: 'matched', strategy: 'variant', isResolved: true, preStockSellable: true })
      .returning();
    await tx
      .insert(wmsTables.productVariantSkuLinks)
      .values(skuIds.map((skuId, k) => ({ productMatchingId: matching.id, skuId, quantity: line.qtyPerUnits[k] })));
    skuIdsByLine.push(skuIds);
  }
  const spareSkuIds: string[] = [];
  for (let k = 0; k < (args.spareSkus ?? 0); k += 1) spareSkuIds.push(await seedStockedSku(tx, at, onHand));

  await logistics.fulfillments.create({ salesOrderId, warehouseId }, tx);
  const [fo] = await tx
    .select({ id: wmsTables.fulfillmentOrders.id })
    .from(wmsTables.fulfillmentOrders)
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
  const [line] = await tx
    .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id))
    .limit(1);
  return {
    ...at,
    salesOrderId,
    lineIds,
    variantIds,
    skuIdsByLine,
    spareSkuIds,
    fulfillmentOrderId: fo.id,
    shipmentId: line.shipmentId,
  };
}

export async function boxLinesOf(tx: DbTx, shipmentId: string) {
  return tx
    .select({
      id: wmsTables.shipmentLines.id,
      skuId: wmsTables.shipmentLines.skuId,
      qty: wmsTables.shipmentLines.qty,
      reservedQty: wmsTables.shipmentLines.reservedQty,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
    .orderBy(asc(wmsTables.shipmentLines.id));
}

export async function itemsOf(tx: DbTx, fulfillmentOrderId: string) {
  return tx
    .select({
      skuId: wmsTables.fulfillmentOrderItems.skuId,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      qty: wmsTables.fulfillmentOrderItems.qty,
      canceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
    })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));
}
```

- [ ] **Step 2: 실패하는 통합 테스트 쓰기**

```ts
// apps/core/src/modules/fulfillment/draft-box/draft-box-amender.integration.spec.ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { inRollbackTx, makeDb, makeDbService, wireLogistics, Wired } from '../services/__support__';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { boxTarget } from './box-target';
import { DraftBoxAmender } from './draft-box-amender';
import { boxLinesOf, itemsOf, seedOrderWithDraftBox, seedStockedSku } from './__support__/draft-box-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID() };

describeIfDb('DraftBoxAmender (#1063 스펙 §6.3)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  function wire(): { logistics: Wired; amender: DraftBoxAmender } {
    const dbService = makeDbService(db);
    const logistics = wireLogistics(dbService);
    const invariant = new FulfillmentInvariantService();
    const amender = new DraftBoxAmender(dbService, logistics.shipmentReservations, invariant, new AuditService(dbService));
    return { logistics, amender };
  }

  const target = (lineId: string, units: number, items: Array<{ skuId: string; qtyPerUnit: number }>) =>
    boxTarget(new Map([[lineId, units]]), new Map([[lineId, items]]));

  async function shipment(tx: DbTx, id: string) {
    const [row] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, id));
    return row;
  }

  it('같은 SKU 의 1개당 수량을 늘리면 줄·FO 항목이 늘고 차이만큼 예약되며 기록이 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { logistics, amender } = wire();
      const fx = await seedOrderWithDraftBox(tx, logistics, { lines: [{ quantity: 3, qtyPerUnits: [1] }] });
      const [a] = fx.skuIdsByLine[0];
      const before = await shipment(tx, fx.shipmentId);

      const result = await amender.amend(fx.shipmentId, target(fx.lineIds[0], 3, [{ skuId: a, qtyPerUnit: 2 }]), 'it', actor, tx);

      expect(result).toMatchObject({ changed: true, manifestVersion: before.manifestVersion + 1, tombstoneShipmentId: null });
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: a, qty: 6, reservedQty: 6 }]);
      expect(await itemsOf(tx, fx.fulfillmentOrderId)).toMatchObject([{ skuId: a, qty: 6, canceledQty: 0 }]);
      const [fo] = await tx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, fx.fulfillmentOrderId));
      expect(fo).toMatchObject({ totalItems: 1, totalQty: 6 });
      const [op] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId ?? ''));
      expect(op).toMatchObject({ type: 'amend', status: 'completed', operatorId: actor.id });
      expect((await shipment(tx, fx.shipmentId)).status).toBe('draft');
    });
  });

  it('SKU 교체: 옛 항목은 qty 0·canceledQty 0, 옛 줄은 묘비로, 새 항목·줄이 생겨 예약되고 배송 프로필을 다시 정한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { logistics, amender } = wire();
      const fx = await seedOrderWithDraftBox(tx, logistics, { lines: [{ quantity: 2, qtyPerUnits: [1] }], spareSkus: 1 });
      const [a] = fx.skuIdsByLine[0];
      const [b] = fx.spareSkuIds;
      const [profile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({ name: `it-${randomUUID().slice(0, 8)}`, sourceType: 'in_house' })
        .returning();
      await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, b));

      const result = await amender.amend(fx.shipmentId, target(fx.lineIds[0], 2, [{ skuId: b, qtyPerUnit: 1 }]), 'it', actor, tx);

      expect(result.tombstoneShipmentId).not.toBeNull();
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: b, qty: 2, reservedQty: 2 }]);
      const items = new Map((await itemsOf(tx, fx.fulfillmentOrderId)).map((item) => [item.skuId, item]));
      // canceledQty 가 0 이어야 출고 완료 판정(fullyShipped)이 이 FO 를 «취소 섞임»으로 보지 않는다
      expect(items.get(a)).toMatchObject({ qty: 0, canceledQty: 0 });
      expect(items.get(b)).toMatchObject({ qty: 2, canceledQty: 0 });
      expect((await shipment(tx, fx.shipmentId)).shippingProfileId).toBe(profile.id);
      expect((await shipment(tx, result.tombstoneShipmentId ?? '')).status).toBe('canceled');
    });
  });

  it('두 라인 박스에서 한 라인만 바꾸면 다른 라인의 줄은 그대로다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { logistics, amender } = wire();
      const fx = await seedOrderWithDraftBox(tx, logistics, {
        lines: [
          { quantity: 1, qtyPerUnits: [1] },
          { quantity: 2, qtyPerUnits: [1] },
        ],
        spareSkus: 1,
      });
      const other = fx.skuIdsByLine[1][0];

      await amender.amend(fx.shipmentId, target(fx.lineIds[0], 1, [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }]), 'it', actor, tx);

      const lines = await boxLinesOf(tx, fx.shipmentId);
      expect(lines.find((line) => line.salesOrderLineId === fx.lineIds[1])).toMatchObject({ skuId: other, qty: 2 });
    });
  });

  it('새 SKU 재고가 모자라면 가능한 만큼만 예약하고 박스는 draft 로 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { logistics, amender } = wire();
      const fx = await seedOrderWithDraftBox(tx, logistics, { lines: [{ quantity: 3, qtyPerUnits: [1] }] });
      const scarce = await seedStockedSku(tx, fx, 1);

      await amender.amend(fx.shipmentId, target(fx.lineIds[0], 3, [{ skuId: scarce, qtyPerUnit: 1 }]), 'it', actor, tx);

      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: scarce, qty: 3, reservedQty: 1 }]);
      expect((await shipment(tx, fx.shipmentId)).status).toBe('draft');
    });
  });

  it('차이가 없으면 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { logistics, amender } = wire();
      const fx = await seedOrderWithDraftBox(tx, logistics, { lines: [{ quantity: 2, qtyPerUnits: [1] }] });
      const before = await shipment(tx, fx.shipmentId);

      const result = await amender.amend(
        fx.shipmentId,
        target(fx.lineIds[0], 2, [{ skuId: fx.skuIdsByLine[0][0], qtyPerUnit: 1 }]),
        'it',
        actor,
        tx,
      );

      expect(result).toEqual({ changed: false, operationId: null, manifestVersion: before.manifestVersion, tombstoneShipmentId: null });
      expect((await shipment(tx, fx.shipmentId)).manifestVersion).toBe(before.manifestVersion);
    });
  });

  it('draft 가 아닌 박스는 BOX_NOT_DRAFT', async () => {
    await inRollbackTx(db, async (tx) => {
      const { logistics, amender } = wire();
      const fx = await seedOrderWithDraftBox(tx, logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }], spareSkus: 1 });
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, fx.shipmentId));

      await expect(
        amender.amend(fx.shipmentId, target(fx.lineIds[0], 1, [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }]), 'it', actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BOX_NOT_DRAFT' }) });
    });
  });
});
```

`seedStockedSku(tx, fx, 1)` 는 `fx` 가 `{ warehouseId, locationId, holderId }` 를 포함하므로 그대로 넘어간다.

- [ ] **Step 3: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/draft-box/draft-box-amender.integration.spec.ts`
Expected: FAIL — `Cannot find module './draft-box-amender'`

- [ ] **Step 4: 구현**

```ts
// apps/core/src/modules/fulfillment/draft-box/draft-box-amender.ts
import { ConflictException, Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { compatibleShippingProfileId } from '../services/shipping-profile';
import { shrinkDraftLines } from '../services/draft-line-shrink';
import {
  assertShipmentHasNoActiveWaybill,
  assertShipmentHasNoCustodyOrActiveWork,
  completeShipmentOperation,
  createShipmentOperation,
  loadShipmentAggregate,
  lockShipmentAggregate,
  shipmentSnapshot,
  ShipmentAggregate,
  ShipmentLineRow,
  ShipmentOperationMember,
  ShipmentRow,
} from '../services/shipment-aggregate';
import { BoxTarget, diffBox } from './box-target';

export interface AmendResult {
  changed: boolean;
  operationId: string | null;
  manifestVersion: number;
  tombstoneShipmentId: string | null;
}

/**
 * 작성 중(draft) 박스를 목표 내용에 맞춘다(#1063 스펙 §6.3). 라인 구성 변경과 S2(주문 수정 전파)가 같은 실행부를 쓴다.
 * 줄어든 수량은 FO 항목 qty 를 줄인다 — canceledQty 는 고객 취소로 읽혀(출고 완료 판정·환불) 쓰면 안 된다.
 */
@Injectable()
export class DraftBoxAmender {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reservations: ShipmentReservationService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly audit: AuditService,
  ) {}

  async amend(shipmentId: string, target: BoxTarget, reason: string, actor: { id: string }, tx?: DbTx): Promise<AmendResult> {
    return this.dbService.run(async (trx) => {
      const aggregate = await lockShipmentAggregate(trx, this.invariant, shipmentId);
      if (aggregate.shipment.status !== 'draft') {
        throw new ConflictException({ code: 'BOX_NOT_DRAFT', message: `Shipment ${shipmentId} must be Draft to amend` });
      }
      // 상태만 draft 이고 작업·보관·송장에 묶인 박스가 있다 — 분할과 같은 가드
      await assertShipmentHasNoCustodyOrActiveWork(trx, aggregate);
      await assertShipmentHasNoActiveWaybill(trx, shipmentId);

      const diff = diffBox(
        aggregate.lines.map((line) => ({
          shipmentLineId: line.id,
          salesOrderLineId: line.salesOrderLineId,
          skuId: line.skuId,
          qty: line.qty,
        })),
        target,
      );
      const manifestVersion = aggregate.shipment.manifestVersion;
      if (diff.decreases.length === 0 && diff.increases.length === 0) {
        return { changed: false, operationId: null, manifestVersion, tombstoneShipmentId: null };
      }
      const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
      const lineOf = (id: string): ShipmentLineRow => {
        const line = lineById.get(id);
        if (!line) throw new Error(`Shipment line ${id} is not in ${shipmentId}`);
        return line;
      };
      const totalAfter =
        aggregate.lines.reduce((total, line) => total + line.qty, 0) -
        diff.decreases.reduce((total, entry) => total + entry.qty, 0) +
        diff.increases.reduce((total, entry) => total + entry.qty, 0);
      // 박스를 비우는 것은 취소다(cancelOutstanding) — amend 로 흉내 내면 묘비·박스 상태 규칙이 갈린다
      if (totalAfter === 0) {
        throw new ConflictException({ code: 'AMEND_WOULD_EMPTY_BOX', message: `Amend would empty shipment ${shipmentId}` });
      }

      // FO 생성과 같은 규칙: 재고 키를 SKU 정렬 순으로 먼저 잡는다(예약 해제·추가가 다시 들어와도 안전)
      await acquireStockAvailabilityLocks(
        trx,
        [
          ...diff.decreases.map((entry) => lineOf(entry.shipmentLineId).skuId),
          ...diff.increases.map((entry) => entry.skuId),
        ].map((skuId) => ({ skuId, warehouseId: aggregate.shipment.warehouseId })),
      );

      const before = shipmentSnapshot(aggregate);
      const operation = await createShipmentOperation(trx, {
        type: 'amend',
        actorId: actor.id,
        reason,
        csCaseId: null,
        note: null,
        // manifestVersion 이 amend 마다 오르므로 박스·버전 쌍이 자연 키다
        idempotencyKey: `amend:${shipmentId}:${manifestVersion}`,
        requestHash: canonicalFulfillmentRequestHash({ shipmentId, manifestVersion, target }),
        before,
      });

      // 줄어듦 먼저 — 늘림의 reservePartial 이 불변식(qty = 정산 + 활성 줄)을 검사하기 전에 줄·FO 항목이 맞아야 한다
      let tombstone: ShipmentRow | null = null;
      if (diff.decreases.length > 0) {
        ({ tombstone } = await shrinkDraftLines(
          this.reservations,
          {
            shipment: aggregate.shipment,
            lines: diff.decreases.map((entry) => ({ line: lineOf(entry.shipmentLineId), qty: entry.qty })),
            reason,
            actorId: actor.id,
            wholeShipment: false,
          },
          trx,
        ));
        const decreaseByItem = new Map<string, number>();
        for (const entry of diff.decreases) {
          const itemId = lineOf(entry.shipmentLineId).fulfillmentOrderItemId;
          decreaseByItem.set(itemId, (decreaseByItem.get(itemId) ?? 0) + entry.qty);
        }
        for (const [itemId, qty] of decreaseByItem) {
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({ qty: sql`${wmsTables.fulfillmentOrderItems.qty} - ${qty}`, updatedAt: new Date() })
            .where(eq(wmsTables.fulfillmentOrderItems.id, itemId));
        }
      }

      const toReserve: Array<{ shipmentLineId: string; qty: number }> = [];
      for (const entry of diff.increases) {
        const fulfillmentOrderId = this.fulfillmentOrderOfLine(aggregate, entry.salesOrderLineId);
        const itemId = await this.growItem(trx, fulfillmentOrderId, entry.salesOrderLineId, entry.skuId, entry.qty);
        if (entry.shipmentLineId) {
          const line = lineOf(entry.shipmentLineId);
          await trx
            .update(wmsTables.shipmentLines)
            .set({ qty: line.qty + entry.qty, lineVersion: line.lineVersion + 1 })
            .where(eq(wmsTables.shipmentLines.id, line.id));
          toReserve.push({ shipmentLineId: line.id, qty: entry.qty });
        } else {
          const [inserted] = await trx
            .insert(wmsTables.shipmentLines)
            .values({ shipmentId, fulfillmentOrderItemId: itemId, skuId: entry.skuId, qty: entry.qty })
            .returning({ id: wmsTables.shipmentLines.id });
          toReserve.push({ shipmentLineId: inserted.id, qty: entry.qty });
        }
      }
      // 재고가 모자라면 가능한 만큼만 잡힌다 — FO 생성과 같이 거절하지 않고 박스는 draft 로 남는다(스펙 §7.3)
      for (const entry of toReserve.sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId))) {
        await this.reservations.reservePartial(entry.shipmentLineId, entry.qty, trx);
      }

      const changedLines = await loadShipmentAggregate(trx, shipmentId);
      const skuRows = await trx
        .select({ deliveryProfileId: wmsTables.skus.deliveryProfileId })
        .from(wmsTables.skus)
        .where(inArray(wmsTables.skus.id, [...new Set(changedLines.lines.map((line) => line.skuId))]));
      await trx
        .update(wmsTables.shipments)
        .set({
          shippingProfileId: compatibleShippingProfileId(skuRows.map((row) => row.deliveryProfileId)),
          manifestVersion: manifestVersion + 1,
          lastUpdated: new Date(),
        })
        .where(eq(wmsTables.shipments.id, shipmentId));
      for (const fulfillmentOrderId of aggregate.fulfillmentOrderIds) {
        await this.recomputeTotals(trx, fulfillmentOrderId);
      }
      await this.reservations.recompute(shipmentId, trx);
      if (tombstone) await this.reservations.recompute(tombstone.id, trx);

      const after = shipmentSnapshot(await loadShipmentAggregate(trx, shipmentId));
      const members: ShipmentOperationMember[] = [{ shipmentId, role: 'source', before, after }];
      if (tombstone) {
        members.push({
          shipmentId: tombstone.id,
          role: 'target',
          before: null,
          after: shipmentSnapshot(await loadShipmentAggregate(trx, tombstone.id)),
        });
      }
      await completeShipmentOperation(trx, operation.id, members);
      await this.audit.logUserActionRequired(
        'shipment.amend',
        'fulfillment',
        `shipment.amend operation ${operation.id}`,
        { userId: actor.id },
        { operationId: operation.id, reason, shipmentId, target, before, after },
        trx,
      );
      return {
        changed: true,
        operationId: operation.id,
        manifestVersion: manifestVersion + 1,
        tombstoneShipmentId: tombstone?.id ?? null,
      };
    }, tx);
  }

  /** 목표의 라인은 이 박스에 이미 줄이 있어야 한다 — 박스에 없던 라인을 들이는 것(합류)은 S1/S2 의 일이다. */
  private fulfillmentOrderOfLine(aggregate: ShipmentAggregate, salesOrderLineId: string): string {
    const line = aggregate.lines.find((candidate) => candidate.salesOrderLineId === salesOrderLineId);
    if (!line) throw new Error(`Line ${salesOrderLineId} has no rows in shipment ${aggregate.shipment.id}`);
    return line.fulfillmentOrderId;
  }

  /** (FO, 라인, SKU) 항목의 수요를 늘린다. 없으면 같은 라인의 항목을 본떠 만든다 — qty 0 으로 대체됐던 항목도 되살린다. */
  private async growItem(
    trx: DbTx,
    fulfillmentOrderId: string,
    salesOrderLineId: string,
    skuId: string,
    qty: number,
  ): Promise<string> {
    const items = wmsTables.fulfillmentOrderItems;
    const sameLine = and(eq(items.fulfillmentOrderId, fulfillmentOrderId), eq(items.salesOrderLineId, salesOrderLineId));
    const [existing] = await trx
      .select({ id: items.id })
      .from(items)
      .where(and(sameLine, eq(items.skuId, skuId)))
      .orderBy(asc(items.id))
      .limit(1);
    if (existing) {
      await trx
        .update(items)
        .set({ qty: sql`${items.qty} + ${qty}`, updatedAt: new Date() })
        .where(eq(items.id, existing.id));
      return existing.id;
    }
    const [template] = await trx
      .select({ salesOrderId: items.salesOrderId, variantId: items.variantId })
      .from(items)
      .where(sameLine)
      .orderBy(asc(items.id))
      .limit(1);
    if (!template) throw new Error(`No fulfillment item to copy for line ${salesOrderLineId}`);
    const [inserted] = await trx
      .insert(items)
      .values({
        fulfillmentOrderId,
        salesOrderId: template.salesOrderId,
        salesOrderLineId,
        mappingSnapshotId: null,
        variantId: template.variantId,
        skuId,
        qty,
        status: 'pending',
      })
      .returning({ id: items.id });
    return inserted.id;
  }

  private async recomputeTotals(trx: DbTx, fulfillmentOrderId: string): Promise<void> {
    const items = wmsTables.fulfillmentOrderItems;
    const [totals] = await trx
      .select({
        // qty 0 항목(대체됨)은 품목 수에 세지 않는다
        totalItems: sql<number>`count(*) filter (where ${items.qty} > 0)::int`,
        totalQty: sql<number>`coalesce(sum(${items.qty}), 0)::int`,
      })
      .from(items)
      .where(eq(items.fulfillmentOrderId, fulfillmentOrderId));
    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({ totalItems: totals.totalItems, totalQty: totals.totalQty, updatedAt: new Date() })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/draft-box/draft-box-amender.integration.spec.ts`
Expected: PASS

실패하면 먼저 `reservePartial` 안 `recompute` 의 불변식 오류인지 본다(`ACTIVE_LINE_QUANTITY` 등) — 줄·FO 항목 갱신 순서가 Step 4 와 다르면 생긴다.

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment/draft-box/
git commit -m "feat(core): DraftBoxAmender — 작성 중 박스를 목표에 맞춘다, 줄어든 수량은 FO 항목 qty 로 (#1063)"
```

---

### Task 8: 주문별 지정 — `PUT /sales-orders/:id/lines/:lineId/composition`

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.types.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.types.spec.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.reader.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.service.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.dto.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.controller.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/__support__/line-composition-edit-wiring.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`

**Interfaces:**
- Consumes: Task 3 매니저·`selectFrozenCompositions`·`compositionItemsProblem`·`sameComposition`·`sortComposition`, Task 6 `boxTarget`·`unitsOfLineInBox`·`BoxLineView`, Task 7 `DraftBoxAmender`, `FulfillmentOrderCreationBacklogService.requeueAwaitingMatching`
- Produces (Task 9 가 쓴다):
  - `SalesOrderAmendmentsService.recordLineCompositionChange(input, tx: DbTx): Promise<string>`
  - `interface BoxOfLine { shipmentId: string; status: string; batchId: string | null; hasActiveWaybill: boolean }`, `isBlockingBox(box: BoxOfLine): boolean`
  - `LineCompositionEditReader` 의 `lockOrder`·`loadLine`·`fulfillmentOrderOf`·`lineHasFulfillmentItems`·`skus`·`boxesOfLines`·`lineQtyByBox`
  - `LineCompositionEditManager.assignToLine(salesOrderId, salesOrderLineId, items, note, actor, tx?): Promise<LineCompositionChangeResult>` 와 private `changeFrozenLine(trx, input)`
  - `LINE_COMPOSITION_OPERATOR_REASON = 'LINE_COMPOSITION_OPERATOR'`, `LINE_COMPOSITION_MATCHING_REASON = 'LINE_COMPOSITION_MATCHING_APPLIED'`
  - `wireLineCompositionEdit(dbService, logistics)` → `{ amender, reader, manager, service }`

- [ ] **Step 1: amendment 기록 메서드 더하기**

`sales-order-amendments.service.ts` 의 `recordChannelAmendment` 아래에 더한다(import 에 `import type { CompositionItem } from '../../product-matching/line-composition/line-composition';`):

```ts
  /**
   * 라인 구성 변경 한 건(#1063 스펙 §7.1-6). 상거래 변경이 아니라 출고 지시만 바뀌므로 fulfillment_only, 이미 박스에 반영된
   * 기록이라 applied. 델타 모양은 쓰는 쪽(LineCompositionEditManager)이 보장한다 — 운영자 DTO 검증을 거치지 않는다.
   */
  async recordLineCompositionChange(
    input: {
      salesOrderId: string;
      salesOrderLineId: string;
      before: readonly CompositionItem[];
      after: readonly CompositionItem[];
      shipmentIds: readonly string[];
      reasonCode: string;
      note: string | null;
      actorId: string;
    },
    tx: DbTx,
  ): Promise<string> {
    const deltas = [
      {
        type: 'line_composition',
        salesOrderLineId: input.salesOrderLineId,
        before: input.before,
        after: input.after,
        shipmentIds: input.shipmentIds,
      },
    ];
    const [amendment] = await tx
      .insert(wmsTables.salesOrderAmendments)
      .values({
        salesOrderId: input.salesOrderId,
        amendmentKind: 'fulfillment_only',
        reasonCode: input.reasonCode,
        note: input.note,
        deltas,
        metadata: {},
        createdBy: input.actorId,
        origin: 'operator',
        status: 'applied',
      })
      .returning();
    await tx.insert(wmsTables.businessLinks).values({
      sourceType: SALES_ORDER_REF_TYPE,
      sourceId: input.salesOrderId,
      sourceExternalRef: null,
      targetType: AMENDMENT_REF_TYPE,
      targetId: amendment.id,
      targetExternalRef: null,
      relationName: 'opened_amendment',
      metadata: { amendmentKind: 'fulfillment_only', origin: 'operator', status: 'applied', deltaTypes: ['line_composition'] },
      occurredAt: amendment.occurredAt,
    });
    return amendment.id;
  }
```

- [ ] **Step 2: 타입·분류 함수와 단위 테스트**

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.types.ts
import {
  CompositionItem,
  CompositionSource,
  sameComposition,
} from '../../product-matching/line-composition/line-composition';

export interface BoxOfLine {
  shipmentId: string;
  status: string;
  /** 활성 작업 항목의 배치. 없으면 null */
  batchId: string | null;
  hasActiveWaybill: boolean;
}

/** 수정할 수 없는 박스 — draft 가 아니거나, draft 여도 작업·송장에 묶였다(스펙 D5). 사전 판정이고 amend 가 잠금 아래에서 다시 막는다. */
export function isBlockingBox(box: BoxOfLine): boolean {
  return box.status !== 'draft' || box.batchId !== null || box.hasActiveWaybill;
}

export type ExistingLineClass = 'changeable' | 'operator' | 'in_progress' | 'same';

/** 일괄 적용 대상 판정(스펙 §7.2). 개별 지정이 먼저, 같음이 그다음 — 같은 구성이면 박스 상태와 무관하게 할 일이 없다. */
export function classifyExistingLine(input: {
  source: CompositionSource;
  frozen: readonly CompositionItem[];
  next: readonly CompositionItem[];
  blocked: boolean;
}): ExistingLineClass {
  if (input.source === 'operator') return 'operator';
  if (sameComposition(input.frozen, input.next)) return 'same';
  if (input.blocked) return 'in_progress';
  return 'changeable';
}

export type ApplySkipReason = 'operator' | 'in_progress' | 'same' | 'units_ambiguous' | 'not_applicable';

export interface LineCompositionChangeResult {
  salesOrderLineId: string;
  source: CompositionSource;
  items: CompositionItem[];
  changedShipmentIds: string[];
  amendmentId: string | null;
}

export interface ExistingLinesImpact {
  variantId: string;
  applicable: boolean;
  newComposition: CompositionItem[] | null;
  changeable: number;
  skippedOperator: number;
  skippedInProgress: number;
  alreadySame: number;
}

export interface ApplyToExistingLinesResult {
  changed: number;
  skipped: Array<{ reason: ApplySkipReason; count: number }>;
}
```

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.types.spec.ts
import { classifyExistingLine, isBlockingBox } from './line-composition-edit.types';

const a1 = [{ skuId: 'a', qtyPerUnit: 1 }];
const b1 = [{ skuId: 'b', qtyPerUnit: 1 }];

describe('classifyExistingLine', () => {
  it.each([
    [{ source: 'operator' as const, frozen: a1, next: b1, blocked: false }, 'operator'],
    [{ source: 'operator' as const, frozen: a1, next: a1, blocked: true }, 'operator'],
    [{ source: 'matching' as const, frozen: a1, next: a1, blocked: true }, 'same'],
    [{ source: 'matching' as const, frozen: a1, next: b1, blocked: true }, 'in_progress'],
    [{ source: 'matching' as const, frozen: a1, next: b1, blocked: false }, 'changeable'],
  ])('%j → %s', (input, expected) => {
    expect(classifyExistingLine(input)).toBe(expected);
  });
});

describe('isBlockingBox', () => {
  it('draft 이고 작업·송장이 없을 때만 막지 않는다', () => {
    expect(isBlockingBox({ shipmentId: 's', status: 'draft', batchId: null, hasActiveWaybill: false })).toBe(false);
    expect(isBlockingBox({ shipmentId: 's', status: 'planned', batchId: null, hasActiveWaybill: false })).toBe(true);
    expect(isBlockingBox({ shipmentId: 's', status: 'draft', batchId: 'b', hasActiveWaybill: false })).toBe(true);
    expect(isBlockingBox({ shipmentId: 's', status: 'draft', batchId: null, hasActiveWaybill: true })).toBe(true);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.types.spec.ts`
순서: 스펙 파일을 먼저 만들어 `npx jest …types.spec.ts` 가 FAIL(`Cannot find module`)인 것을 보고, 타입 파일을 만든 뒤 다시 돌린다.
Expected: PASS

- [ ] **Step 3: 실패하는 통합 테스트 쓰기**

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { findCompositionInvariantViolations } from '../../product-matching/line-composition/__support__/composition-invariant';
import { PoliciesService } from '../../sales-order/services/policies.service';
import { SalesOrdersService } from '../../sales-order/services/sales-orders.service';
import { outboxPublisherFor } from '../outbox/__support__/outbox-publisher.factory';
import { inRollbackTx, makeDb, seedSalesOrder, wireLogistics } from '../services/__support__';
import { ambientDbService, assembleOutbound } from '../services/__support__/simple-outbound-wiring';
import { boxLinesOf, itemsOf, seedOrderWithDraftBox, seedStockedSku } from '../draft-box/__support__/draft-box-fixtures';
import { wireLineCompositionEdit } from './__support__/line-composition-edit-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID() };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const edit = wireLineCompositionEdit(dbService, logistics);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    new PoliciesService(dbService),
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  return { logistics, edit, salesOrders };
}

async function lineOf(tx: DbTx, id: string) {
  const [line] = await tx.select().from(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, id));
  return line;
}

describeIfDb('주문별 라인 구성 지정 (#1063 스펙 §7.1)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('FO 전: 상품매칭 없이 운영자 지정 → 매칭 대기가 깨고 → FO 가 지정 구성으로 생긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      // FO 가 없는 두 번째 주문: 매칭 없는 variant
      const sku = await seedStockedSku(tx, fx, 10);
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 2 }] });
      await tx
        .insert(wmsTables.fulfillmentOrderCreationBacklogs)
        .values({ salesOrderId, status: 'awaiting_matching', waitingVariantIds: [] });

      const result = await w.edit.manager.assignToLine(salesOrderId, lineIds[0], [{ skuId: sku, qtyPerUnit: 3 }], null, actor, tx);

      expect(result).toMatchObject({ source: 'operator', changedShipmentIds: [], amendmentId: null });
      const [backlog] = await tx
        .select({ status: wmsTables.fulfillmentOrderCreationBacklogs.status })
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));
      expect(backlog.status).toBe('pending');

      await w.logistics.fulfillments.create({ salesOrderId, warehouseId: fx.warehouseId }, tx);
      const items = await tx
        .select({ skuId: wmsTables.fulfillmentOrderItems.skuId, qty: wmsTables.fulfillmentOrderItems.qty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, lineIds[0]));
      expect(items).toEqual([{ skuId: sku, qty: 6 }]);
      expect((await lineOf(tx, lineIds[0])).compositionSource).toBe('operator');
    });
  });

  it('FO 뒤: SKU 교체가 박스를 맞추고 amendment 를 남기며, 다시 불러도 바뀌지 않고, 뒤이은 고객 전체 취소가 통과한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 2, qtyPerUnits: [1] }], spareSkus: 1 });
      const [b] = fx.spareSkuIds;

      const first = await w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: b, qtyPerUnit: 2 }], '오매칭', actor, tx);
      expect(first).toMatchObject({ source: 'operator', changedShipmentIds: [fx.shipmentId] });
      expect(first.amendmentId).not.toBeNull();
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: b, qty: 4 }]);
      const [amendment] = await tx
        .select()
        .from(wmsTables.salesOrderAmendments)
        .where(eq(wmsTables.salesOrderAmendments.id, first.amendmentId ?? ''));
      expect(amendment).toMatchObject({ amendmentKind: 'fulfillment_only', origin: 'operator', status: 'applied', note: '오매칭' });

      const again = await w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: b, qtyPerUnit: 2 }], null, actor, tx);
      expect(again).toMatchObject({ changedShipmentIds: [], amendmentId: null });

      await w.salesOrders.cancel(fx.salesOrderId, { cancelledBy: 'naver', metadata: { sourceEventId: `f-${randomUUID()}` } }, tx);
      const items = new Map((await itemsOf(tx, fx.fulfillmentOrderId)).map((item) => [item.skuId, item]));
      expect(items.get(fx.skuIdsByLine[0][0])).toMatchObject({ qty: 0, canceledQty: 0 });
      expect(items.get(b)).toMatchObject({ qty: 4, canceledQty: 4 });
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('부분 취소가 있던 라인의 1개당 수량을 바꾼 뒤 부분 취소가 통과한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 3, qtyPerUnits: [1] }] });
      const [a] = fx.skuIdsByLine[0];
      await w.salesOrders.cancel(
        fx.salesOrderId,
        { lines: [{ salesOrderLineId: fx.lineIds[0], quantity: 1 }], cancelledBy: 'naver', metadata: { sourceEventId: `p-${randomUUID()}` } },
        tx,
      );

      await w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: a, qtyPerUnit: 2 }], null, actor, tx);
      expect(await itemsOf(tx, fx.fulfillmentOrderId)).toMatchObject([{ skuId: a, qty: 5, canceledQty: 1 }]);

      await w.salesOrders.cancel(
        fx.salesOrderId,
        { lines: [{ salesOrderLineId: fx.lineIds[0], quantity: 1 }], cancelledBy: 'naver', metadata: { sourceEventId: `q-${randomUUID()}` } },
        tx,
      );
      expect(await itemsOf(tx, fx.fulfillmentOrderId)).toMatchObject([{ skuId: a, qty: 5, canceledQty: 3 }]);
    });
  });

  it('라인이 담긴 박스가 draft 가 아니면 LINE_BOX_NOT_DRAFT 와 박스 목록', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }], spareSkus: 1 });
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, fx.shipmentId));

      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'LINE_BOX_NOT_DRAFT',
          boxes: [{ shipmentId: fx.shipmentId, status: 'planned', batchId: null }],
        }),
      });
    });
  });

  it('SKU 가 다른 박스로 갈라진 라인은 COMPOSITION_UNITS_AMBIGUOUS, 아무것도 바뀌지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1, 1] }], spareSkus: 1 });
      const [, second] = fx.skuIdsByLine[0];
      // 두 번째 SKU 줄만 새 draft 박스로 옮긴다(분할과 같은 결과)
      const [other] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: fx.warehouseId, status: 'draft' })
        .returning();
      const lines = await boxLinesOf(tx, fx.shipmentId);
      const moved = lines.find((line) => line.skuId === second);
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: other.id })
        .where(eq(wmsTables.shipmentLines.id, moved?.id ?? ''));

      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'COMPOSITION_UNITS_AMBIGUOUS' }) });
      expect((await lineOf(tx, fx.lineIds[0])).compositionSource).toBe('matching');
    });
  });

  it('디지털 라인·직배송 SKU·FO 있는데 미굳힘 라인을 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }], spareSkus: 1 });
      const [spare] = fx.spareSkuIds;

      await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, spare));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DROP_SHIP_NOT_SUPPORTED' }) });
      await tx.update(wmsTables.skus).set({ stockType: 'physical' }).where(eq(wmsTables.skus.id, spare));

      // 백필 전 공백 흉내: 출처와 구성 행을 함께 지운다(불변식 유지)
      await tx
        .delete(wmsTables.salesOrderLineCompositions)
        .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, fx.lineIds[0]));
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: null, compositionSetAt: null })
        .where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'COMPOSITION_NOT_FROZEN' }) });

      await tx
        .update(wmsTables.salesOrderLines)
        .set({ fulfillmentKind: 'digital', requiresShipping: false })
        .where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'LINE_NOT_PHYSICAL' }) });
    });
  });

  it('FO 뒤에 FO 항목이 없는 라인은 LINE_NOT_IN_FULFILLMENT, 전체 취소된 주문은 SALES_ORDER_CANCELLED', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }], spareSkus: 1 });
      const [spare] = fx.spareSkuIds;
      // FO 를 만든 뒤에 붙은 라인(void 매칭·FO 전 전량 취소 라인과 같은 처지 — FO 항목이 없다)
      const [late] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({ salesOrderId: fx.salesOrderId, variantId: randomUUID(), productName: 'late', quantity: 1, unitPrice: 1000 })
        .returning();
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, late.id, [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'LINE_NOT_IN_FULFILLMENT' }) });

      await tx.update(wmsTables.salesOrders).set({ status: 'cancelled' }).where(eq(wmsTables.salesOrders.id, fx.salesOrderId));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SALES_ORDER_CANCELLED' }) });
    });
  });
});
```

- [ ] **Step 4: 리더 만들기**

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.reader.ts
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { DbTx, SalesOrderLine, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { compositionFromMatching, CompositionItem } from '../../product-matching/line-composition/line-composition';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { ACTIVE_WORK_ITEM_STATUSES } from '../services/work-item-status';
import { BoxLineView } from '../draft-box/box-target';
import { BoxOfLine } from './line-composition-edit.types';

// 이미 끝난 박스 — 라인을 «담고» 있어도 수정 판정에서 뺀다(묘비·대체)
const DEAD_SHIPMENT_STATUSES = ['canceled', 'superseded'] as const;

/** 라인 구성 수정 경로의 조회(#1063 스펙 §7). 쓰기는 LineCompositionEditManager 가 한다. */
@Injectable()
export class LineCompositionEditReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSkuMapping: ProductSkuMappingService,
  ) {}

  /** 판매주문을 잠근다 — FO 생성(createV2)과 같은 «판매주문 먼저» 잠금 순서(스펙 §5.4). */
  async lockOrder(trx: DbTx, salesOrderId: string): Promise<{ id: string; status: string } | null> {
    const [order] = await trx
      .select({ id: wmsTables.salesOrders.id, status: wmsTables.salesOrders.status })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .for('update');
    return order ?? null;
  }

  async loadLine(trx: DbTx, salesOrderId: string, salesOrderLineId: string): Promise<SalesOrderLine | null> {
    const [line] = await trx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(
        and(eq(wmsTables.salesOrderLines.id, salesOrderLineId), eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId)),
      );
    return line ?? null;
  }

  async fulfillmentOrderOf(
    trx: DbTx,
    salesOrderId: string,
  ): Promise<{ id: string; fulfillmentMode: string | null; ownerId: string | null } | null> {
    const [fo] = await trx
      .select({
        id: wmsTables.fulfillmentOrders.id,
        fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
        ownerId: wmsTables.fulfillmentOrders.ownerId,
      })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .limit(1);
    return fo ?? null;
  }

  async lineHasFulfillmentItems(trx: DbTx, salesOrderLineId: string): Promise<boolean> {
    const [row] = await trx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId))
      .limit(1);
    return Boolean(row);
  }

  async skus(trx: DbTx, skuIds: readonly string[]) {
    if (skuIds.length === 0) return [];
    return trx
      .select({ id: wmsTables.skus.id, stockType: wmsTables.skus.stockType, holderId: wmsTables.skus.holderId })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, [...skuIds]));
  }

  /** 라인마다 그 라인이 담긴 살아 있는 박스(묘비·대체 제외). */
  async boxesOfLines(trx: DbTx, salesOrderLineIds: readonly string[]): Promise<Map<string, BoxOfLine[]>> {
    const result = new Map<string, BoxOfLine[]>();
    if (salesOrderLineIds.length === 0) return result;
    const rows = await trx
      .selectDistinct({
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        shipmentId: wmsTables.shipments.id,
        status: wmsTables.shipments.status,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(
        and(
          inArray(wmsTables.fulfillmentOrderItems.salesOrderLineId, [...salesOrderLineIds]),
          notInArray(wmsTables.shipments.status, [...DEAD_SHIPMENT_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.shipments.id));
    const shipmentIds = [...new Set(rows.map((row) => row.shipmentId))];
    if (shipmentIds.length === 0) return result;
    const work = await trx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId, batchId: wmsTables.outboundBatchWorkItems.batchId })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      );
    const waybills = await trx
      .select({ shipmentId: wmsTables.waybills.shipmentId })
      .from(wmsTables.waybills)
      .where(
        and(
          inArray(wmsTables.waybills.shipmentId, shipmentIds),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      );
    const batchByShipment = new Map(work.map((row) => [row.shipmentId, row.batchId]));
    const withWaybill = new Set(waybills.map((row) => row.shipmentId));
    for (const row of rows) {
      if (row.salesOrderLineId === null) continue;
      const boxes = result.get(row.salesOrderLineId) ?? [];
      boxes.push({
        shipmentId: row.shipmentId,
        status: row.status,
        batchId: batchByShipment.get(row.shipmentId) ?? null,
        hasActiveWaybill: withWaybill.has(row.shipmentId),
      });
      result.set(row.salesOrderLineId, boxes);
    }
    return result;
  }

  /** 박스마다 그 라인의 줄(§6.2 담긴 개수 계산의 입력). */
  async lineQtyByBox(
    trx: DbTx,
    salesOrderLineId: string,
    shipmentIds: readonly string[],
  ): Promise<Map<string, BoxLineView[]>> {
    const result = new Map<string, BoxLineView[]>();
    if (shipmentIds.length === 0) return result;
    const rows = await trx
      .select({
        shipmentId: wmsTables.shipmentLines.shipmentId,
        shipmentLineId: wmsTables.shipmentLines.id,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(
        and(
          inArray(wmsTables.shipmentLines.shipmentId, [...shipmentIds]),
          eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId),
        ),
      );
    for (const row of rows) {
      const lines = result.get(row.shipmentId) ?? [];
      lines.push({ shipmentLineId: row.shipmentLineId, salesOrderLineId: row.salesOrderLineId, skuId: row.skuId, qty: row.qty });
      result.set(row.shipmentId, lines);
    }
    return result;
  }

  /** 상품매칭이 지금 정하는 실물 구성. void·미해결이면 null — 일괄 적용 대상이 없다(스펙 D4). */
  async matchingComposition(trx: DbTx, variantId: string): Promise<CompositionItem[] | null> {
    const resolved = compositionFromMatching(await this.productSkuMapping.getByVariant(variantId, trx));
    return resolved.kind === 'follow' ? resolved.items : null;
  }
}
```

(`existingLineCandidates`·`linesForApply`·`previewExistingLines` 는 Task 9 가 더한다. `dbService` 는 그때 쓰인다.)

- [ ] **Step 5: 매니저 만들기**

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import {
  CompositionItem,
  compositionItemsProblem,
  CompositionSource,
  isDigitalFulfillmentLine,
  sameComposition,
  sortComposition,
} from '../../product-matching/line-composition/line-composition';
import { selectFrozenCompositions } from '../../product-matching/line-composition/frozen-compositions';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { SalesOrderAmendmentsService } from '../../sales-order/services/sales-order-amendments.service';
import { FulfillmentOrderCreationBacklogService } from '../backlog/fulfillment-order-creation-backlog.service';
import { boxTarget, unitsOfLineInBox } from '../draft-box/box-target';
import { DraftBoxAmender } from '../draft-box/draft-box-amender';
import { LineCompositionEditReader } from './line-composition-edit.reader';
import { isBlockingBox, LineCompositionChangeResult } from './line-composition-edit.types';

export const LINE_COMPOSITION_OPERATOR_REASON = 'LINE_COMPOSITION_OPERATOR';
export const LINE_COMPOSITION_MATCHING_REASON = 'LINE_COMPOSITION_MATCHING_APPLIED';

function conflict(code: string, message: string, extra: Record<string, unknown> = {}): ConflictException {
  return new ConflictException({ code, message, ...extra });
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

/**
 * 판매주문 라인 구성 수정(#1063 스펙 §7). 판매주문 잠금 → 구성 쓰기 → 박스 맞추기 → amendment 를 한 트랜잭션으로 한다 —
 * 구성만 바뀌고 박스가 안 바뀌면 다음 FO 판정·취소 비율이 박스와 다른 구성을 읽는다.
 */
@Injectable()
export class LineCompositionEditManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: LineCompositionEditReader,
    private readonly compositions: LineCompositionManager,
    private readonly amender: DraftBoxAmender,
    private readonly backlog: FulfillmentOrderCreationBacklogService,
    private readonly amendments: SalesOrderAmendmentsService,
  ) {}

  async assignToLine(
    salesOrderId: string,
    salesOrderLineId: string,
    items: readonly CompositionItem[],
    note: string | null,
    actor: { id: string },
    tx?: DbTx,
  ): Promise<LineCompositionChangeResult> {
    const problem = compositionItemsProblem(items);
    if (problem) throw badRequest('COMPOSITION_ITEMS_INVALID', problem);
    const after = sortComposition(items);
    return this.dbService.run(async (trx) => {
      const order = await this.reader.lockOrder(trx, salesOrderId);
      if (!order) throw new NotFoundException(`Sales order ${salesOrderId} not found`);
      if (order.status === 'cancelled') throw conflict('SALES_ORDER_CANCELLED', `Sales order ${salesOrderId} is cancelled`);
      const line = await this.reader.loadLine(trx, salesOrderId, salesOrderLineId);
      if (!line) throw new NotFoundException(`Line ${salesOrderLineId} is not in sales order ${salesOrderId}`);
      if (isDigitalFulfillmentLine(line)) throw badRequest('LINE_NOT_PHYSICAL', `Line ${line.id} is not physical`);

      const fo = await this.reader.fulfillmentOrderOf(trx, salesOrderId);
      await this.assertSkus(trx, after, fo?.ownerId ?? null);

      if (!fo) {
        // FO 전 1회 지정(스펙 D1): 구성을 굳히고 매칭 대기를 깨운다. FO 생성은 같은 판매주문 잠금 뒤에서 이 구성을 읽는다
        await this.compositions.assignByOperator(line.id, after, actor.id, trx);
        await this.backlog.requeueAwaitingMatching(salesOrderId, trx);
        return { salesOrderLineId: line.id, source: 'operator', items: after, changedShipmentIds: [], amendmentId: null };
      }
      if (fo.fulfillmentMode === 'drop_ship') {
        throw badRequest('DROP_SHIP_NOT_SUPPORTED', `Fulfillment order ${fo.id} is drop-ship`);
      }
      if (!(await this.reader.lineHasFulfillmentItems(trx, line.id))) {
        throw conflict('LINE_NOT_IN_FULFILLMENT', `Line ${line.id} has no fulfillment items`);
      }
      const before = (await selectFrozenCompositions(trx, [line.id])).get(line.id) ?? [];
      if (line.compositionSource === null || before.length === 0) {
        throw conflict('COMPOSITION_NOT_FROZEN', `Line ${line.id} composition is not frozen`);
      }
      if (sameComposition(before, after)) {
        // 박스는 그대로. 출처만 operator 로 — 이후 일괄 적용이 이 라인을 건너뛰게(스펙 D3)
        if (line.compositionSource !== 'operator') await this.compositions.assignByOperator(line.id, after, actor.id, trx);
        return { salesOrderLineId: line.id, source: 'operator', items: after, changedShipmentIds: [], amendmentId: null };
      }
      return this.changeFrozenLine(trx, {
        salesOrderId,
        salesOrderLineId: line.id,
        before,
        after,
        source: 'operator',
        actorId: actor.id,
        note,
        reasonCode: LINE_COMPOSITION_OPERATOR_REASON,
      });
    }, tx);
  }

  /** FO 가 있고 굳힌 라인의 구성을 바꾸고 박스를 맞춘다. 호출자가 판매주문을 잠갔다. */
  private async changeFrozenLine(
    trx: DbTx,
    input: {
      salesOrderId: string;
      salesOrderLineId: string;
      before: readonly CompositionItem[];
      after: CompositionItem[];
      source: CompositionSource;
      actorId: string;
      note: string | null;
      reasonCode: string;
    },
  ): Promise<LineCompositionChangeResult> {
    const boxes = (await this.reader.boxesOfLines(trx, [input.salesOrderLineId])).get(input.salesOrderLineId) ?? [];
    const blocking = boxes.filter(isBlockingBox);
    if (blocking.length > 0) {
      throw conflict('LINE_BOX_NOT_DRAFT', `Line ${input.salesOrderLineId} is in boxes that are not editable`, {
        boxes: blocking.map((box) => ({ shipmentId: box.shipmentId, status: box.status, batchId: box.batchId })),
      });
    }
    const shipmentIds = boxes.map((box) => box.shipmentId).sort();
    const linesByBox = await this.reader.lineQtyByBox(trx, input.salesOrderLineId, shipmentIds);
    // 담긴 개수는 옛 구성으로 센다 — 구성을 바꾼 뒤엔 «이 줄 수량이 몇 개분인가»를 알 수 없다
    const unitsByBox = new Map(
      shipmentIds.map((id) => [id, unitsOfLineInBox(input.salesOrderLineId, linesByBox.get(id) ?? [], input.before)]),
    );

    if (input.source === 'operator') {
      await this.compositions.assignByOperator(input.salesOrderLineId, input.after, input.actorId, trx);
    } else {
      await this.compositions.replaceMatchingComposition(input.salesOrderLineId, input.after, trx);
    }

    const changedShipmentIds: string[] = [];
    for (const shipmentId of shipmentIds) {
      const units = unitsByBox.get(shipmentId) ?? 0;
      if (units === 0) continue;
      const target = boxTarget(new Map([[input.salesOrderLineId, units]]), new Map([[input.salesOrderLineId, input.after]]));
      const result = await this.amender.amend(shipmentId, target, input.reasonCode, { id: input.actorId }, trx);
      if (result.changed) changedShipmentIds.push(shipmentId);
    }
    const amendmentId = await this.amendments.recordLineCompositionChange(
      {
        salesOrderId: input.salesOrderId,
        salesOrderLineId: input.salesOrderLineId,
        before: input.before,
        after: input.after,
        shipmentIds: changedShipmentIds,
        reasonCode: input.reasonCode,
        note: input.note,
        actorId: input.actorId,
      },
      trx,
    );
    return {
      salesOrderLineId: input.salesOrderLineId,
      source: input.source,
      items: input.after,
      changedShipmentIds,
      amendmentId,
    };
  }

  /** FO 생성과 같은 SKU 규칙 — 직배송 SKU 는 창고 SKU 와 섞지 않고, 3PL FO 는 화주가 같아야 한다. */
  private async assertSkus(trx: DbTx, items: readonly CompositionItem[], ownerId: string | null): Promise<void> {
    const ids = items.map((item) => item.skuId);
    const rows = await this.reader.skus(trx, ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const sku = byId.get(id);
      if (!sku) throw new BadRequestException(`SKU ${id} not found`);
      if (sku.stockType === 'drop_shipped') throw badRequest('DROP_SHIP_NOT_SUPPORTED', `SKU ${id} is drop-shipped`);
      if (ownerId && sku.holderId !== ownerId) {
        throw badRequest('SKU_HOLDER_MISMATCH_FOR_3PL', `SKU ${id} belongs to another holder`);
      }
    }
  }
}
```

- [ ] **Step 6: 서비스·DTO·컨트롤러·배선·모듈 등록**

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.service.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { LineCompositionEditManager } from './line-composition-edit.manager';
import { LineCompositionEditReader } from './line-composition-edit.reader';
import { PutLineCompositionDto } from './line-composition-edit.dto';
import { LineCompositionChangeResult } from './line-composition-edit.types';

@Injectable()
export class LineCompositionEditService {
  constructor(
    private readonly reader: LineCompositionEditReader,
    private readonly manager: LineCompositionEditManager,
  ) {}

  assignToLine(
    salesOrderId: string,
    salesOrderLineId: string,
    dto: PutLineCompositionDto,
    actor: { id: string },
    tx?: DbTx,
  ): Promise<LineCompositionChangeResult> {
    return this.manager.assignToLine(salesOrderId, salesOrderLineId, dto.items, dto.note ?? null, actor, tx);
  }
}
```

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LineCompositionItemDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '판매 1개당 SKU 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(10000)
  qtyPerUnit: number;
}

export class PutLineCompositionDto {
  @ApiProperty({ type: [LineCompositionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineCompositionItemDto)
  items: LineCompositionItemDto[];

  @ApiProperty({ required: false, description: '운영자 메모 — amendment 에 남는다' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class LineCompositionChangeResponseDto {
  @ApiProperty() salesOrderLineId: string;
  @ApiProperty({ enum: ['matching', 'operator'] }) source: string;
  @ApiProperty({ type: [LineCompositionItemDto] }) items: LineCompositionItemDto[];
  @ApiProperty({ type: [String], description: '내용이 바뀐 박스' }) changedShipmentIds: string[];
  @ApiProperty({ nullable: true, description: '박스가 바뀌었을 때만 남는 amendment' }) amendmentId: string | null;
}
```

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.controller.ts
import { Body, Controller, Param, ParseUUIDPipe, Put, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { LineCompositionChangeResponseDto, PutLineCompositionDto } from './line-composition-edit.dto';
import { LineCompositionEditService } from './line-composition-edit.service';

type AuthenticatedUser = { userId?: string; id?: string; sub?: string };

function actorOf(user: AuthenticatedUser | undefined): { id: string } {
  const id = user?.userId ?? user?.id ?? user?.sub;
  if (!id) throw new UnauthorizedException('Authenticated actor is required');
  return { id };
}

// 판매주문 경로지만 박스를 바꾸므로 fulfillment 모듈에 둔다 — sales-order 모듈은 fulfillment 를 import 하지 못한다(순환)
@ApiTags('Sales Orders')
@Controller('sales-orders')
export class SalesOrderLineCompositionController {
  constructor(private readonly edits: LineCompositionEditService) {}

  @Put(':id/lines/:lineId/composition')
  @ApiOperation({ summary: '판매주문 라인 하나의 SKU 구성 지정(이 주문만) — FO 전이면 매칭 대기를 풀고, FO 뒤면 작성 중 박스를 맞춘다' })
  @ApiOkResponse({ type: LineCompositionChangeResponseDto })
  assign(
    @Param('id', ParseUUIDPipe) salesOrderId: string,
    @Param('lineId', ParseUUIDPipe) salesOrderLineId: string,
    @Body() dto: PutLineCompositionDto,
    @User() user?: AuthenticatedUser,
  ) {
    return this.edits.assignToLine(salesOrderId, salesOrderLineId, dto, actorOf(user));
  }
}
```

(`actorOf` 와 `AuthenticatedUser` 는 Task 9 의 두 번째 컨트롤러가 같은 파일에서 쓴다.)

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/__support__/line-composition-edit-wiring.ts
import { DbService } from '@app/db';
import { wmsSchema } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { SalesOrderAmendmentsService } from '../../../sales-order/services/sales-order-amendments.service';
import { DraftBoxAmender } from '../../draft-box/draft-box-amender';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { Wired } from '../../services/__support__';
import { LineCompositionEditManager } from '../line-composition-edit.manager';
import { LineCompositionEditReader } from '../line-composition-edit.reader';
import { LineCompositionEditService } from '../line-composition-edit.service';

export function wireLineCompositionEdit(dbService: DbService<typeof wmsSchema>, logistics: Wired) {
  const amender = new DraftBoxAmender(
    dbService,
    logistics.shipmentReservations,
    new FulfillmentInvariantService(),
    new AuditService(dbService),
  );
  const reader = new LineCompositionEditReader(dbService, logistics.productSkuMapping);
  const manager = new LineCompositionEditManager(
    dbService,
    reader,
    logistics.lineCompositionManager,
    amender,
    logistics.backlog,
    new SalesOrderAmendmentsService(dbService),
  );
  const service = new LineCompositionEditService(reader, manager);
  return { amender, reader, manager, service };
}
```

`fulfillment.module.ts`:
- import 다섯 줄 추가: `DraftBoxAmender`(`./draft-box/draft-box-amender`), `LineCompositionEditReader`·`LineCompositionEditManager`·`LineCompositionEditService`, `SalesOrderLineCompositionController`(`./line-composition-edit/...`)
- `controllers` 배열 끝(`OutboundRefillController,` 다음)에 `SalesOrderLineCompositionController,`
- `providers` 배열에 `DraftBoxAmender, LineCompositionEditReader, LineCompositionEditManager, LineCompositionEditService,`

필요한 provider 는 이미 이 모듈 그래프에 있다: `ShipmentReservationService`·`FulfillmentInvariantService`(이 모듈), `AuditService`(SharedModule), `LineCompositionManager`·`ProductSkuMappingService`(ProductMatchingModule export), `FulfillmentOrderCreationBacklogService`(FulfillmentOrderCreationBacklogModule export), `SalesOrderAmendmentsService`(SalesOrderModule export).

- [ ] **Step 7: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts`
Expected: PASS(Step 3 직후에 한 번 돌리면 `Cannot find module '../line-composition-edit.manager'` 등으로 FAIL — 그걸 먼저 본다)

자주 걸릴 곳:
- 「FO 뒤 SKU 교체 → 전체 취소」에서 `V2 fulfillment item ... outside the composition` 이면 amend 가 옛 항목 qty 를 안 줄였다(Task 7)
- `SalesOrdersService` 생성자 인자는 `channel-order-change.integration.spec.ts` 와 대조

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/line-composition-edit apps/core/src/modules/sales-order`
Expected: 에러 0 · PASS

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/fulfillment/line-composition-edit/ apps/core/src/modules/fulfillment/fulfillment.module.ts \
  apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts
git commit -m "feat(core): 판매주문 라인 구성 주문별 지정 API — FO 전 매칭 대기 해소, FO 뒤 작성 중 박스 맞추기 (#1063)"
```

---

### Task 9: 일괄 적용 — 미리보기와 적용

**Files:**
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.service.ts`
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.dto.ts`
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`
- Create: `apps/core/src/modules/fulfillment/line-composition-edit/apply-to-existing-lines.integration.spec.ts`

**Interfaces:**
- Consumes: Task 8 전부
- Produces:
  - `LineCompositionEditReader.existingLineCandidates(trx, variantId): Promise<Array<{ salesOrderLineId: string; salesOrderId: string }>>`
  - `LineCompositionEditReader.linesForApply(trx, lineIds): Promise<Array<{ id: string; compositionSource: CompositionSource | null }>>`
  - `LineCompositionEditReader.previewExistingLines(variantId, tx?): Promise<ExistingLinesImpact>`
  - `LineCompositionEditManager.applyToExistingLines(variantId, actor, tx?): Promise<ApplyToExistingLinesResult>`
  - `GET /matchings/variants/:variantId/existing-lines-impact` · `POST /matchings/variants/:variantId/apply-to-existing-lines`

- [ ] **Step 1: 실패하는 통합 테스트 쓰기**

```ts
// apps/core/src/modules/fulfillment/line-composition-edit/apply-to-existing-lines.integration.spec.ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, wireLogistics } from '../services/__support__';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { boxLinesOf, seedOrderWithDraftBox } from '../draft-box/__support__/draft-box-fixtures';
import { wireLineCompositionEdit } from './__support__/line-composition-edit-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID() };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  return { logistics, edit: wireLineCompositionEdit(dbService, logistics) };
}

describeIfDb('기존 출고에도 적용 (#1063 스펙 §7.2)', () => {
  jest.setTimeout(180_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('미리보기는 넷으로 세고, 적용은 «바꿀 수 있음»만 바꾸며, 다시 보내면 이미 같음이 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      const variantId = fx.variantIds[0];
      const [newSku] = fx.spareSkuIds;
      // 같은 variant 를 판 주문 둘을 더 만든다 — 픽스처가 만든 자기 variant 를 첫 주문의 variant 로 옮긴다(굳힌 구성은 각자의 SKU)
      const operatorOrder = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      const busyOrder = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      for (const other of [operatorOrder, busyOrder]) {
        await tx.update(wmsTables.salesOrderLines).set({ variantId }).where(eq(wmsTables.salesOrderLines.id, other.lineIds[0]));
      }
      await w.edit.manager.assignToLine(
        operatorOrder.salesOrderId,
        operatorOrder.lineIds[0],
        [{ skuId: newSku, qtyPerUnit: 1 }],
        null,
        actor,
        tx,
      );
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, busyOrder.shipmentId));
      // 상품매칭을 새 SKU 로 바꾼다
      const [matching] = await tx
        .select({ id: wmsTables.productMatchings.id })
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, variantId));
      await tx
        .update(wmsTables.productVariantSkuLinks)
        .set({ skuId: newSku })
        .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matching.id));

      expect(await w.edit.reader.previewExistingLines(variantId, tx)).toEqual({
        variantId,
        applicable: true,
        newComposition: [{ skuId: newSku, qtyPerUnit: 1 }],
        changeable: 1,
        skippedOperator: 1,
        skippedInProgress: 1,
        alreadySame: 0,
      });

      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({
        changed: 1,
        skipped: [
          { reason: 'operator', count: 1 },
          { reason: 'in_progress', count: 1 },
        ],
      });
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: newSku, qty: 1 }]);
      const [line] = await tx.select().from(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      expect(line.compositionSource).toBe('matching');

      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({
        changed: 0,
        skipped: [
          { reason: 'operator', count: 1 },
          { reason: 'in_progress', count: 1 },
          { reason: 'same', count: 1 },
        ],
      });
    });
  });

  it('미리보기 뒤 운영자가 지정한 라인은 적용 때 다시 판정해 건너뛴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }], spareSkus: 2 });
      const variantId = fx.variantIds[0];
      const [matching] = await tx
        .select({ id: wmsTables.productMatchings.id })
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, variantId));
      await tx
        .update(wmsTables.productVariantSkuLinks)
        .set({ skuId: fx.spareSkuIds[0] })
        .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matching.id));
      expect((await w.edit.reader.previewExistingLines(variantId, tx)).changeable).toBe(1);

      await w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: fx.spareSkuIds[1], qtyPerUnit: 1 }], null, actor, tx);

      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({
        changed: 0,
        skipped: [{ reason: 'operator', count: 1 }],
      });
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: fx.spareSkuIds[1] }]);
    });
  });

  it('상품매칭이 void 면 적용할 것이 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      const variantId = fx.variantIds[0];
      await tx.update(wmsTables.productMatchings).set({ strategy: 'void' }).where(eq(wmsTables.productMatchings.variantId, variantId));

      expect(await w.edit.reader.previewExistingLines(variantId, tx)).toMatchObject({ applicable: false, changeable: 0 });
      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({ changed: 0, skipped: [] });
    });
  });
});
```

스펙 §10 의 «운영자 지정과 동시 실행»은 두 연결의 실제 동시 실행이 아니라 두 번째 테스트(«미리보기 뒤 지정 → 적용 때 다시 판정»)로 고정한다. 직렬화는 두 경로가 모두 잡는 판매주문 `FOR UPDATE` 가 맡고, 커밋된 픽스처를 지우는 정리 코드(이 저장소의 통합 스펙이 쓰는 WHERE 없는 DELETE)가 얻는 것보다 위험하다.

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/line-composition-edit/apply-to-existing-lines.integration.spec.ts`
Expected: FAIL — `previewExistingLines is not a function`

- [ ] **Step 3: 리더에 후보·미리보기 더하기**

`line-composition-edit.reader.ts` 의 import 를 다음으로 넓힌다(Task 8 에서 뺐던 것들):

```ts
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { compositionFromMatching, CompositionItem, CompositionSource } from '../../product-matching/line-composition/line-composition';
import { selectFrozenCompositions } from '../../product-matching/line-composition/frozen-compositions';
import { BoxOfLine, classifyExistingLine, ExistingLinesImpact, isBlockingBox } from './line-composition-edit.types';
```

클래스 끝에 더한다:

```ts
  /**
   * 일괄 적용 후보: 그 variant 의 굳힌 라인 중 아직 안 나간 수량이 있는 것(스펙 §7.2 «FO 미완료»). 직배송 FO 는 박스가 없어
   * 맞출 것이 없으므로 뺀다. FO 전 운영자 지정 라인은 FO 항목이 없어 여기 안 들어온다 — FO 가 생길 때 그 구성으로 만들어진다.
   */
  async existingLineCandidates(
    trx: DbTx,
    variantId: string,
  ): Promise<Array<{ salesOrderLineId: string; salesOrderId: string }>> {
    const lines = wmsTables.salesOrderLines;
    const items = wmsTables.fulfillmentOrderItems;
    const orders = wmsTables.fulfillmentOrders;
    return trx
      .selectDistinct({ salesOrderLineId: lines.id, salesOrderId: lines.salesOrderId })
      .from(lines)
      // fulfillment_order_items.sales_order_line_id 는 varchar 다 — uuid 를 text 로 맞춰 조인한다
      .innerJoin(items, eq(items.salesOrderLineId, sql`${lines.id}::text`))
      .innerJoin(orders, eq(orders.id, items.fulfillmentOrderId))
      .where(
        and(
          eq(lines.variantId, variantId),
          isNotNull(lines.compositionSource),
          sql`${items.qty} - ${items.shippedQty} - ${items.canceledQty} > 0`,
          or(isNull(orders.fulfillmentMode), ne(orders.fulfillmentMode, 'drop_ship')),
        ),
      )
      .orderBy(asc(lines.salesOrderId), asc(lines.id));
  }

  async linesForApply(
    trx: DbTx,
    lineIds: readonly string[],
  ): Promise<Array<{ id: string; compositionSource: CompositionSource | null }>> {
    if (lineIds.length === 0) return [];
    return trx
      .select({ id: wmsTables.salesOrderLines.id, compositionSource: wmsTables.salesOrderLines.compositionSource })
      .from(wmsTables.salesOrderLines)
      .where(inArray(wmsTables.salesOrderLines.id, [...lineIds]))
      .orderBy(asc(wmsTables.salesOrderLines.id));
  }

  /** «기존 출고에도 적용» 미리보기(스펙 §7.2). 읽기만 한다 — 적용은 잠금 아래에서 다시 판정한다. */
  async previewExistingLines(variantId: string, tx?: DbTx): Promise<ExistingLinesImpact> {
    return this.dbService.run(async (trx) => {
      const next = await this.matchingComposition(trx, variantId);
      if (!next) {
        return {
          variantId,
          applicable: false,
          newComposition: null,
          changeable: 0,
          skippedOperator: 0,
          skippedInProgress: 0,
          alreadySame: 0,
        };
      }
      const lineIds = (await this.existingLineCandidates(trx, variantId)).map((row) => row.salesOrderLineId);
      const lines = await this.linesForApply(trx, lineIds);
      const frozen = await selectFrozenCompositions(trx, lineIds);
      const boxes = await this.boxesOfLines(trx, lineIds);
      const counts = { changeable: 0, operator: 0, in_progress: 0, same: 0 };
      for (const line of lines) {
        if (line.compositionSource === null) continue;
        counts[
          classifyExistingLine({
            source: line.compositionSource,
            frozen: frozen.get(line.id) ?? [],
            next,
            blocked: (boxes.get(line.id) ?? []).some(isBlockingBox),
          })
        ] += 1;
      }
      return {
        variantId,
        applicable: true,
        newComposition: next,
        changeable: counts.changeable,
        skippedOperator: counts.operator,
        skippedInProgress: counts.in_progress,
        alreadySame: counts.same,
      };
    }, tx);
  }
```

- [ ] **Step 4: 매니저에 적용 더하기**

import 에 `HttpException` 과 타입들을 더한다:

```ts
import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApplySkipReason,
  ApplyToExistingLinesResult,
  classifyExistingLine,
  isBlockingBox,
  LineCompositionChangeResult,
} from './line-composition-edit.types';
```

파일 위쪽(`badRequest` 아래)에:

```ts
type ApplyOutcome = 'changed' | ApplySkipReason;

// 주문 하나의 적용이 이 코드로 실패하면 그 주문의 후보 라인을 이 사유로 센다. 나머지 오류는 그대로 던진다 —
// 앞 주문들은 이미 커밋됐고, 다시 보내면 «이미 같음»이 되어 멱등이다.
const SKIP_REASON_BY_CODE: Record<string, ApplySkipReason> = {
  LINE_BOX_NOT_DRAFT: 'in_progress',
  BOX_NOT_DRAFT: 'in_progress',
  SHIPMENT_ACTIVE_WORK_ITEM: 'in_progress',
  SHIPMENT_CUSTODY_EXISTS: 'in_progress',
  SHIPMENT_ACTIVE_INVOICE: 'in_progress',
  COMPOSITION_UNITS_AMBIGUOUS: 'units_ambiguous',
};
const SKIP_REASON_ORDER: ApplySkipReason[] = ['operator', 'in_progress', 'same', 'units_ambiguous', 'not_applicable'];

function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
}
```

클래스 안 `assignToLine` 아래에:

```ts
  /**
   * 상품매칭 저장 뒤 «기존 출고에도 적용»(스펙 §7.2). 주문마다 별도 트랜잭션 — 한 트랜잭션에 몰면 잠금이 여러 판매주문·재고 키에
   * 걸쳐 출고 작업과 교착·대기가 커진다. tx 를 받으면(테스트) 그 안에서 주문마다 savepoint 로 같은 경계를 흉내 낸다.
   */
  async applyToExistingLines(variantId: string, actor: { id: string }, tx?: DbTx): Promise<ApplyToExistingLinesResult> {
    const candidates = await this.dbService.run((trx) => this.reader.existingLineCandidates(trx, variantId), tx);
    const byOrder = new Map<string, string[]>();
    for (const row of candidates) {
      byOrder.set(row.salesOrderId, [...(byOrder.get(row.salesOrderId) ?? []), row.salesOrderLineId]);
    }
    const counts = new Map<ApplyOutcome, number>();
    const bump = (outcome: ApplyOutcome, by = 1) => counts.set(outcome, (counts.get(outcome) ?? 0) + by);
    for (const [salesOrderId, lineIds] of [...byOrder].sort(([a], [b]) => a.localeCompare(b))) {
      try {
        const outcomes = await this.dbService.run(
          (trx) => trx.transaction((savepoint) => this.applyToOrder(savepoint, salesOrderId, variantId, lineIds, actor)),
          tx,
        );
        for (const outcome of outcomes) bump(outcome);
      } catch (error) {
        const code = errorCode(error);
        const reason = code ? SKIP_REASON_BY_CODE[code] : undefined;
        if (!reason) throw error;
        bump(reason, lineIds.length);
      }
    }
    return {
      changed: counts.get('changed') ?? 0,
      skipped: SKIP_REASON_ORDER.flatMap((reason) => {
        const count = counts.get(reason) ?? 0;
        return count > 0 ? [{ reason, count }] : [];
      }),
    };
  }

  private async applyToOrder(
    trx: DbTx,
    salesOrderId: string,
    variantId: string,
    lineIds: readonly string[],
    actor: { id: string },
  ): Promise<ApplyOutcome[]> {
    const order = await this.reader.lockOrder(trx, salesOrderId);
    if (!order || order.status === 'cancelled') return lineIds.map(() => 'in_progress');
    // 미리보기 뒤 상품매칭·라인이 바뀌었을 수 있다 — 잠금 아래에서 다시 읽는다
    const next = await this.reader.matchingComposition(trx, variantId);
    if (!next) return lineIds.map(() => 'not_applicable');
    const lines = await this.reader.linesForApply(trx, lineIds);
    const frozen = await selectFrozenCompositions(trx, lineIds);
    const boxes = await this.reader.boxesOfLines(trx, lineIds);
    const outcomes: ApplyOutcome[] = [];
    for (const line of lines) {
      if (line.compositionSource === null) continue;
      const before = frozen.get(line.id) ?? [];
      const decision = classifyExistingLine({
        source: line.compositionSource,
        frozen: before,
        next,
        blocked: (boxes.get(line.id) ?? []).some(isBlockingBox),
      });
      if (decision !== 'changeable') {
        outcomes.push(decision);
        continue;
      }
      await this.changeFrozenLine(trx, {
        salesOrderId,
        salesOrderLineId: line.id,
        before,
        after: next,
        source: 'matching',
        actorId: actor.id,
        note: null,
        reasonCode: LINE_COMPOSITION_MATCHING_REASON,
      });
      outcomes.push('changed');
    }
    return outcomes;
  }
```

`trx.transaction((savepoint) => ...)` 의 `savepoint` 를 `DbTx` 로 넘기는 것은 PR 1 의 출고 대기열 워커(`fulfillment-order-creation-backlog.worker.ts:120`)와 같은 꼴이다. 타입이 안 맞으면 그 파일이 하는 방식을 그대로 따른다.

- [ ] **Step 5: 서비스·DTO·컨트롤러·모듈**

서비스에 더한다:

```ts
  previewExistingLines(variantId: string, tx?: DbTx): Promise<ExistingLinesImpact> {
    return this.reader.previewExistingLines(variantId, tx);
  }

  applyToExistingLines(variantId: string, actor: { id: string }, tx?: DbTx): Promise<ApplyToExistingLinesResult> {
    return this.manager.applyToExistingLines(variantId, actor, tx);
  }
```

(import 에 `ApplyToExistingLinesResult`·`ExistingLinesImpact` 추가)

DTO 파일 끝에:

```ts
export class ExistingLinesImpactResponseDto {
  @ApiProperty() variantId: string;
  @ApiProperty({ description: '상품매칭이 실물 SKU 로 해결됐나 — 아니면 적용할 것이 없다' }) applicable: boolean;
  @ApiProperty({ type: [LineCompositionItemDto], nullable: true }) newComposition: LineCompositionItemDto[] | null;
  @ApiProperty({ description: '바꿀 수 있음' }) changeable: number;
  @ApiProperty({ description: '개별 지정이라 건너뜀' }) skippedOperator: number;
  @ApiProperty({ description: '작업 중 박스라 건너뜀' }) skippedInProgress: number;
  @ApiProperty({ description: '이미 같음' }) alreadySame: number;
}

export class ApplySkippedCountDto {
  @ApiProperty({ enum: ['operator', 'in_progress', 'same', 'units_ambiguous', 'not_applicable'] }) reason: string;
  @ApiProperty() count: number;
}

export class ApplyToExistingLinesResponseDto {
  @ApiProperty() changed: number;
  @ApiProperty({ type: [ApplySkippedCountDto] }) skipped: ApplySkippedCountDto[];
}
```

컨트롤러 파일에 두 번째 컨트롤러(import 에 `Get`·`Post`·`ExistingLinesImpactResponseDto`·`ApplyToExistingLinesResponseDto` 추가):

```ts
// 상품매칭 저장 다이얼로그가 부른다. ProductMatchingModule 은 fulfillment 를 import 하지 못해(순환) 여기 둔다
@ApiTags('Product Matching')
@Controller('matchings')
export class MatchingExistingLinesController {
  constructor(private readonly edits: LineCompositionEditService) {}

  @Get('variants/:variantId/existing-lines-impact')
  @ApiOperation({ summary: '상품매칭 변경이 이미 굳힌 출고 라인에 미칠 영향(미리보기)' })
  @ApiOkResponse({ type: ExistingLinesImpactResponseDto })
  impact(@Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.edits.previewExistingLines(variantId);
  }

  @Post('variants/:variantId/apply-to-existing-lines')
  @ApiOperation({ summary: '상품매칭을 기존 출고(작성 중 박스)에도 적용 — 개별 지정·작업 중 박스는 건너뛴다' })
  @ApiOkResponse({ type: ApplyToExistingLinesResponseDto })
  apply(@Param('variantId', ParseUUIDPipe) variantId: string, @User() user?: AuthenticatedUser) {
    return this.edits.applyToExistingLines(variantId, actorOf(user));
  }
}
```

`fulfillment.module.ts` 의 controllers 에 `MatchingExistingLinesController,` 를 더한다(import 도).

- [ ] **Step 6: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/line-composition-edit/apply-to-existing-lines.integration.spec.ts apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts`
Expected: PASS

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/line-composition-edit scripts/security`
Expected: 에러 0 · PASS(`route-authz-audit` 가 새 라우트를 «무력화된 스코프»로 잡지 않는다 — `@RequireScopes` 를 안 썼다)

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/line-composition-edit/ apps/core/src/modules/fulfillment/fulfillment.module.ts
git commit -m "feat(core): 상품매칭 «기존 출고에도 적용» 미리보기·적용 — 개별 지정·작업 중 건너뜀 (#1063)"
```

---

### Task 10: 최종 게이트와 PR

**Files:** 없음(검증·PR 본문)

- [ ] **Step 1: 전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npm run lint
```

Expected: type-check 0 · jest 실패 0 · lint 가 고친 것이 있으면 확인 후 커밋. `scripts/security` 가드(IDOR 좌표)는 전체 jest 에 들어 있다 — 이 PR 은 IDOR 명단 파일(`store-*.service.ts`·`ownership.service.ts`)을 건드리지 않는다

- [ ] **Step 2: 이 PR 이 건드린 통합 스펙 전부(스크래치 DB)**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand \
  apps/core/src/modules/product-matching \
  apps/core/src/modules/fulfillment/draft-box \
  apps/core/src/modules/fulfillment/line-composition-edit \
  apps/core/src/modules/fulfillment/services/fulfillment-order-item-qty-zero.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/shipment-reservation.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-invariant.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/outbound-v2-scenarios.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/outbound-v2-lifecycle-scenarios.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile \
  apps/core/src/modules/sales-order
```

Expected: 새 실패 0(알려진 base-red 1건 — 묘비 박스 entrance-password — 은 develop 과 대조해 제외)

- [ ] **Step 3: 부팅 확인(DI)**

새 provider 6개·컨트롤러 2개는 jest 로 DI 가 검증되지 않는다. 로컬 인프라(postgres·kafka·redis)가 떠 있으면:

```bash
timeout 120 npm run start:main:dev 2>&1 | tee /tmp/claude-1000/-home-pauseb-workspace-almondyoung-server/4fdd2ebf-71af-4cee-867d-7e06638a98e9/scratchpad/core-boot.log | grep -m1 -E "Nest application successfully started|Nest can't resolve|Error"
```

Expected: `Nest application successfully started`. `Nest can't resolve dependencies` 가 나오면 Task 8 Step 6 의 모듈 등록을 고친다. 인프라가 없으면 이 단계를 건너뛰었다고 PR 본문에 적는다(배포 전 사람이 확인).

- [ ] **Step 4: 라이브 확인 SQL 을 PR 본문에**

PR 본문 «배포 전 라이브 확인»(읽기 전용, `core` DB):

```sql
-- 마이그레이션 전: 완화할 CHECK 가 지금 지키는 조건 — 0 이어야 한다(아니면 이미 어딘가 어긋났다)
SELECT count(*) FROM fulfillment_order_items WHERE qty <= 0;
-- COMPOSITION_NOT_FROZEN 이 운영자에게 보일 라인 — PR 1 백필 뒤 0 이었다
SELECT count(DISTINCT l.id) FROM sales_order_lines l
JOIN fulfillment_order_items foi ON foi.sales_order_line_id = l.id::text
WHERE l.composition_source IS NULL;
```

- [ ] **Step 5: push·PR**

```bash
git push -u origin feat/1063-line-composition-pr2
gh pr create --base develop --title "feat(core): 판매주문 라인 구성 PR 2 — 주문별 지정·기존 출고 적용·작성 중 박스 맞추기 (#1063)" --body-file /tmp/claude-1000/-home-pauseb-workspace-almondyoung-server/4fdd2ebf-71af-4cee-867d-7e06638a98e9/scratchpad/pr-1063-2-body.md
```

PR 본문에 넣을 것:
- 요약: 스펙 경로·이슈 #1063·#1016 14번, API 셋(경로 그대로)
- **배포 순서 `migrate → deploy`** — 마이그 1건(CHECK 완화). 롤링 중 옛 태스크는 qty 0 FO 항목을 불변식 위반으로 읽는다: qty 0 은 새 API 만 만들므로 **롤아웃 완료 전에는 수정 API 를 쓰지 않는다**(PR 3 화면이 같은 배포에 실려도 마찬가지)
- 이 PR 이 바꾸는 기존 동작 둘: (1) 고객 취소의 SKU 비율을 라인 구성에서 읽는다 — 덤으로 «FO 생성 전 부분 취소가 있던 라인의 후속 취소» 409 가 풀린다 (2) FO 항목 qty 0 허용
- 화면 변화 없음(PR 3). amendment 목록의 새 델타 `line_composition` 은 admin-web 이 지금 타입 문자열 그대로 보여 준다(PR 3 에서 문구)
- 라이브 확인 SQL(Step 4), 게이트 결과, Step 3 부팅 확인 여부
- 끝에 세션 링크 줄
