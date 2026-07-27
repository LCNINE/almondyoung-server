# Phase 3 플랜 A — 단순출고 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현장 작업자가 종이 송장을 스캔하고 상품을 한 번씩만 스캔하면 피킹·검수·출고완료가 원장에 온전히 기록되는 단순출고 경로를 core 와 warehouse-app 에 구현한다.

**Architecture:** core 에 복합 유스케이스 서비스(`SimpleOutboundService`)를 신설해 한 트랜잭션 안에서 `discrete` 피킹 전략 → `completePick` → 검수 → 자동 dispatch 를 몰아준다. 앱은 스캔 1회에 요청 1회만 보내고 응답의 라인 진행을 그대로 렌더한다. 피킹 전략 계약(`PickingStrategy`)과 ADR-0027 원장 모델은 건드리지 않는다 — 기존 전략을 조합할 뿐이다.

**Tech Stack:** NestJS + Drizzle(postgres.js) / Tauri 2 + React 19 + TanStack Router·Query + Vitest / Jest(core)

## Global Constraints

- 설계 스펙: `docs/superpowers/specs/2026-07-26-warehouse-app-phase3-outbound-design.md` (§4 core 변경, §5~6 앱, §8 플랜 A 범위). 스펙과 충돌하면 스펙이 우선이다.
- **스키마 변경 금지.** 이 플랜에 마이그레이션은 없다. `npm run db:generate:core` 를 부르지 않는다.
- **트랜잭션 규약(ADR-0025)**: 공용 메서드는 마지막 파라미터로 `tx?: DbTx`, private 헬퍼는 `tx: DbTx` 필수. 로컬 `type Tx = …` 재선언 금지, per-class `inTx` 헬퍼 금지. `DbTx` 는 `apps/core/src/modules/inventory/schema/inventory.schema` 에서 import.
- **core 쿼리 규약**: `db.query.*` 금지, `with` 관계 금지, `any`/`as` 캐스팅 금지. `trx.select().from().innerJoin().where().orderBy()` + drizzle 연산자만.
- 모든 fulfillment mutation 은 `FulfillmentCommandService.execute` 를 통과하고 `Idempotency-Key` 를 요구한다. 파생 키는 기존 컨벤션대로 접두사를 붙인다 (`simple:${key}:pick:${allocationId}` 형태).
- **앱 인증은 Bearer 고정** (`apiAuthMode: 'bearer'`) — cookie 모드는 네이티브에서 구조적으로 불가.
- 앱 테스트는 `ApiClientProvider` 에 목 `ApiClient` 를 주입하는 기존 패턴을 쓴다. 실제 `plugin-http` 를 목하지 않는다.
- core 통합 테스트는 `DATABASE_URL` 이 있을 때만 돌고(`const describeIfDb = DATABASE_URL ? describe : describe.skip`), `inRollbackTx` 로 롤백한다.
- 린트 판정은 **변경 파일 스코프의 신규 error 0** 이다. repo 전역 `npm run lint` 의 기존 debt 는 이 플랜의 책임이 아니다.
- 커밋 메시지는 한국어 제목 + 필요한 경우 본문. 커밋 끝에 `Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD` 를 붙인다.

---

## File Structure

**core (`apps/core/src/modules/fulfillment/`)**

| 파일 | 책임 |
|---|---|
| `services/__support__/logistics-fixtures.ts` (수정) | `seedPickableShipment` — 아직 피킹 전인 배치/work item/운송장/재고 픽스처 |
| `services/shipment-dispatch.service.ts` (수정) | `inspectShipmentLines` 공개 메서드 추출, `inspectionScan`·`forceDispatch` 에 `tx?` 추가 |
| `services/simple-outbound.service.ts` (신규) | 단순출고 복합 유스케이스 — 준비·스캔·강제완료 |
| `services/simple-outbound.service.integration.spec.ts` (신규) | 위 서비스의 실DB 통합 테스트 |
| `reader/shipment-waybill.reader.ts` (신규) | 운송장번호 → shipment/라인 진행 조회 (읽기 전용) |
| `dto/simple-outbound.dto.ts` (신규) | 요청·응답 DTO |
| `controllers/simple-outbound.controller.ts` (신규) | 3 엔드포인트 |
| `fulfillment.module.ts` (수정) | 신규 provider·controller 등록 |

**app (`native/warehouse-app/src/`)**

| 파일 | 책임 |
|---|---|
| `domains/outbound/types.ts` (신규) | core DTO 대응 타입 |
| `domains/outbound/queries.ts` (신규) | `useShipmentByWaybill`, `useOutboundBatches` |
| `domains/outbound/mutations.ts` (신규) | `useSimpleOutboundScan`, `useForceSimpleOutbound` |
| `domains/outbound/OutboundQueueScreen.tsx` (신규) | 송장 스캔 + 진행중 복구 + 배치 요약 |
| `domains/outbound/SimpleOutboundScreen.tsx` (신규) | 박스 작업 — 스캔·진행·완료·예외 |
| `app/routes/OutboundRoute.tsx`, `app/routes/SimpleOutboundRoute.tsx` (신규) | 라우트 컴포넌트 |
| `app/routeTree.tsx` (수정) | `/outbound`, `/outbound/simple/$shipmentId`, `/picking`·`/packing` 리다이렉트 |
| `profiles/handheld/HandheldHome.tsx`, `profiles/station/StationHome.tsx` (수정) | 타일 통합 |
| `core/data/errorMessage.ts` (수정) | `outbound` 문맥 추가 + 403 문맥 우선 처리 |

---

## Part 1 — core

### Task 1: 피킹 전 상태 픽스처 `seedPickableShipment`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts`
- Test: `apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: 없음
- Produces: `seedPickableShipment(tx: DbTx): Promise<PickableShipmentFixture>` — 필드 `actorId, warehouseId, holderId, skuId, skuCode, barcode, locationId, ledgerVersion, shipmentId, shipmentLineId, batchId, workItemId, waybillId, trackingNo, qty`

`shipment-dispatch.integration.spec.ts:119` 의 `seedReadyShipment` 는 **이미 피킹이 끝난** 상태(work item `packing`, plan·session·HAND_IN 존재, `inspectedQty: 1`)를 만든다. 단순출고는 그 앞 단계(work item `queued`, plan·session 없음)에서 시작하므로 별도 픽스처가 필요하다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.integration.spec.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './index';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('seedPickableShipment', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('아직 피킹 전인 work item 과 발급된 운송장을 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);

      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId))
        .limit(1);
      expect(workItem.status).toBe('queued');
      expect(workItem.pickerId).toBeNull();
      expect(workItem.leaseVersion).toBe(0);

      const plans = await tx
        .select()
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.batchId, fixture.batchId));
      expect(plans).toHaveLength(0);

      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
        .limit(1);
      expect(line.inspectedQty).toBe(0);
      expect(line.qty).toBe(fixture.qty);

      const [reservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.shipmentLineId, fixture.shipmentLineId),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        )
        .limit(1);
      expect(reservation.quantity).toBe(fixture.qty);

      const [waybill] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.id, fixture.waybillId))
        .limit(1);
      expect(waybill.status).toBe('registered');
      expect(waybill.trackingNo).toBe(fixture.trackingNo);
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.integration.spec.ts`
Expected: FAIL — `seedPickableShipment` is not exported / is not a function

- [ ] **Step 3: 픽스처 구현**

`logistics-fixtures.ts` 파일 끝에 추가한다. `canonicalFulfillmentRequestHash` 는 `../fulfillment-command.service` 에서, `randomUUID` 는 `crypto` 에서 import 한다(파일 상단 import 에 없으면 추가).

```ts
export interface PickableShipmentFixture {
  actorId: string;
  warehouseId: string;
  holderId: string;
  skuId: string;
  skuCode: string;
  barcode: string;
  locationId: string;
  ledgerVersion: number;
  shipmentId: string;
  shipmentLineId: string;
  batchId: string;
  workItemId: string;
  waybillId: string;
  trackingNo: string;
  qty: number;
}

/**
 * 단순출고 시작 지점 픽스처 — 재고·예약·운송장은 준비됐고 피킹은 아직 시작하지
 * 않은 상태(work item `queued`, plan·session 없음). `seedReadyShipment`(검수 직전)
 * 와 달리 plan/session/HAND_IN 을 심지 않는다 — 그것을 만드는 것이 피검증 대상이다.
 */
export async function seedPickableShipment(tx: DbTx, qty = 2): Promise<PickableShipmentFixture> {
  const suffix = randomUUID();
  const actorId = randomUUID();
  const [warehouse] = await tx
    .insert(wmsTables.warehouses)
    .values({ name: `simple-warehouse-${suffix}`, supportedPickingStrategies: ['discrete'] })
    .returning();
  const [holder] = await tx.insert(wmsTables.holders).values({ name: `simple-holder-${suffix}` }).returning();
  const skuCode = `SIMPLE-${suffix}`;
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({ name: 'Simple SKU', code: skuCode, holderId: holder.id })
    .returning();
  const barcode = `880${suffix.replaceAll('-', '').slice(0, 10)}`;
  await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
  const [location] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: warehouse.id, code: `SIMPLE-ZONE-${suffix}`, locationType: 'zone' })
    .returning();
  const [ledger] = await tx
    .insert(wmsTables.stockLedgers)
    .values({ skuId: sku.id, warehouseId: warehouse.id, locationId: location.id, stockState: 'ON_HAND', qty })
    .returning();

  const [salesOrder] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `simple-order-${suffix}`,
      salesChannel: 'medusa',
      shippingAddress: {},
      orderDate: new Date(),
    })
    .returning();
  const [salesOrderLine] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId: salesOrder.id,
      variantId: randomUUID(),
      productName: 'Simple product',
      quantity: qty,
      channelOrderItemId: `simple-item-${suffix}`,
      channelProductId: `simple-product-${suffix}`,
    })
    .returning();
  const [fulfillmentOrder] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({ salesOrderId: salesOrder.id, warehouseId: warehouse.id, status: 'processing', totalQty: qty })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: fulfillmentOrder.id,
      salesOrderId: salesOrder.id,
      salesOrderLineId: salesOrderLine.id,
      skuId: sku.id,
      qty,
      reservedQty: qty,
      status: 'processing',
    })
    .returning();
  const recipientSnapshot = { recipientName: 'Simple Test', phone: '010-3333-4444' };
  const [shipment] = await tx
    .insert(wmsTables.shipments)
    .values({ warehouseId: warehouse.id, status: 'planned', recipientSnapshot, plannedAt: new Date() })
    .returning();
  const [line] = await tx
    .insert(wmsTables.shipmentLines)
    .values({
      shipmentId: shipment.id,
      fulfillmentOrderItemId: item.id,
      skuId: sku.id,
      qty,
      reservedQty: qty,
      inspectedQty: 0,
    })
    .returning();
  await tx.insert(wmsTables.stockReservations).values({
    targetType: 'SHIPMENT_LINE',
    targetId: line.id,
    shipmentLineId: line.id,
    skuId: sku.id,
    warehouseId: warehouse.id,
    quantity: qty,
    status: 'confirmed',
    requestedAt: new Date(),
  });
  const [batch] = await tx
    .insert(wmsTables.outboundBatches)
    .values({
      batchNumber: `SIMPLE-BATCH-${suffix}`,
      warehouseId: warehouse.id,
      pickingMethod: 'individual',
      status: 'created',
    })
    .returning();
  const [workItem] = await tx
    .insert(wmsTables.outboundBatchWorkItems)
    .values({ batchId: batch.id, shipmentId: shipment.id, status: 'queued', leaseVersion: 0 })
    .returning();
  const trackingNo = `SIMPLE-TRACK-${suffix}`;
  const [waybill] = await tx
    .insert(wmsTables.waybills)
    .values({
      shipmentId: shipment.id,
      source: 'manual',
      carrier: 'HANJIN',
      status: 'registered',
      trackingNo,
      manifestVersion: shipment.manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(recipientSnapshot),
    })
    .returning();

  return {
    actorId,
    warehouseId: warehouse.id,
    holderId: holder.id,
    skuId: sku.id,
    skuCode,
    barcode,
    locationId: location.id,
    ledgerVersion: ledger.version,
    shipmentId: shipment.id,
    shipmentLineId: line.id,
    batchId: batch.id,
    workItemId: workItem.id,
    waybillId: waybill.id,
    trackingNo,
    qty,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.integration.spec.ts`
Expected: PASS (1 passed)

DB 가 없으면 `skipped` 로 표시된다 — 그건 실패가 아니지만, 이 태스크는 **DB 가 있는 환경에서 최소 한 번 실제 PASS 를 확인**해야 완료다. `npm run test:core:integration:local` 로 로컬 DB 를 띄우는 경로가 있다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/__support__/
git commit -m "test(core): 단순출고용 피킹 전 상태 픽스처 seedPickableShipment 추가"
```

---

### Task 2: `inspectShipmentLines` 추출 + dispatch 메서드에 `tx` 전달

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts:166-306`
- Test: `apps/core/src/modules/fulfillment/services/shipment-dispatch.integration.spec.ts` (테스트 추가)

**Interfaces:**
- Consumes: Task 1 `seedPickableShipment` (미사용 — 이 태스크는 기존 `seedReadyShipment` 를 쓴다)
- Produces:
  - `ShipmentDispatchService.inspectShipmentLines(shipmentId: string, input: { entries: Array<{ shipmentLineId: string; quantity: number }>; actor: ShipmentDispatchActor; idempotencyKey: string }, tx?: DbTx): Promise<ShipmentDispatchResponse>`
  - `ShipmentDispatchService.inspectionScan(shipmentId, input: InspectionScanInput, tx?: DbTx)` — 시그니처에 `tx?` 추가
  - `ShipmentDispatchService.forceDispatch(shipmentId, input: ForceShipmentDispatchInput, tx?: DbTx)` — 시그니처에 `tx?` 추가

단순출고는 라인을 이미 알고 있으므로 바코드로 라인을 되찾는 우회가 필요 없다. 그리고 복합 서비스가 같은 트랜잭션을 공유해야 하므로 `tx` 를 받아야 한다. **검수·자동 dispatch 로직은 복제하지 않는다 — 한 구현만 남긴다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`shipment-dispatch.integration.spec.ts` 의 최상위 `describeIfDb` 블록 안, 기존 `it` 들과 같은 레벨에 추가한다:

```ts
  it('inspectShipmentLines 는 라인을 직접 받아 전량 검수 시 자동 출고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedReadyShipment(tx);
      // 픽스처는 inspectedQty=1 (qty=2) 로 시작한다 — 남은 1개를 라인 지정으로 검수한다.
      const response = await services(tx).inspectShipmentLines(
        fixture.shipment.id,
        {
          entries: [{ shipmentLineId: fixture.line.id, quantity: 1 }],
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: `direct-inspect-${randomUUID()}`,
        },
        tx,
      );

      expect(response.status).toBe('shipped');
      expect(response.dispatchAttemptId).not.toBeNull();

      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id))
        .limit(1);
      expect(line.inspectedQty).toBe(2);
    });
  });

  it('inspectionScan 은 바코드 경로를 유지한다 (회귀)', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedReadyShipment(tx);
      const response = await services(tx).inspectionScan(
        fixture.shipment.id,
        {
          barcode: fixture.barcode,
          quantity: 1,
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: `barcode-inspect-${randomUUID()}`,
        },
        tx,
      );
      expect(response.status).toBe('shipped');
      expect(response.shipmentLineId).toBe(fixture.line.id);
    });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/shipment-dispatch.integration.spec.ts -t inspectShipmentLines`
Expected: FAIL — `services(tx).inspectShipmentLines is not a function`

- [ ] **Step 3: 구현 — `inspectionScan` 을 두 조각으로 나눈다**

`shipment-dispatch.service.ts` 의 `inspectionScan`(166행)을 아래로 교체한다. `applyInspectionEntries` 는 기존 본문(185~222행)을 라인 배열 루프로 일반화한 것이다.

```ts
  async inspectionScan(
    shipmentId: string,
    input: InspectionScanInput,
    tx?: DbTx,
  ): Promise<ShipmentDispatchResponse> {
    this.workflowGate.assertV2MutationAllowed('shipment.inspection.scan');
    this.assertActor(input.actor);
    this.assertPositiveInteger('quantity', input.quantity);

    return this.commands.execute(
      {
        commandType: 'shipment.inspection.scan',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          barcode: input.barcode.trim(),
          quantity: input.quantity,
          actorId: input.actor.id,
        },
      },
      async (tx2) => {
        const aggregate = await this.lockAggregate(shipmentId, tx2);
        this.assertDispatchCandidate(aggregate, input.actor, false);
        const line = await this.resolveInspectionLine(input.barcode, input.quantity, aggregate.lines, tx2);
        const response = await this.applyInspectionEntries(
          aggregate,
          [{ shipmentLineId: line.id, quantity: input.quantity }],
          input.actor,
          input.idempotencyKey,
          tx2,
        );
        return {
          response,
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: response.dispatchAttemptId ?? undefined,
        };
      },
      tx,
    );
  }

  /**
   * 라인을 이미 아는 호출자(단순출고)를 위한 검수 진입점. 바코드 해석만 건너뛰고
   * 커스터디 이동·inspectedQty·전량 검수 시 자동 dispatch 는 같은 코드를 지난다.
   */
  async inspectShipmentLines(
    shipmentId: string,
    input: {
      entries: Array<{ shipmentLineId: string; quantity: number }>;
      actor: ShipmentDispatchActor;
      idempotencyKey: string;
    },
    tx?: DbTx,
  ): Promise<ShipmentDispatchResponse> {
    this.workflowGate.assertV2MutationAllowed('shipment.inspection.lines');
    this.assertActor(input.actor);
    if (input.entries.length === 0) throw new BadRequestException('entries must not be empty');
    for (const entry of input.entries) this.assertPositiveInteger('quantity', entry.quantity);

    return this.commands.execute(
      {
        commandType: 'shipment.inspection.lines',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          entries: [...input.entries]
            .map((entry) => ({ shipmentLineId: entry.shipmentLineId, quantity: entry.quantity }))
            .sort((left, right) => left.shipmentLineId.localeCompare(right.shipmentLineId)),
          actorId: input.actor.id,
        },
      },
      async (tx2) => {
        const aggregate = await this.lockAggregate(shipmentId, tx2);
        this.assertDispatchCandidate(aggregate, input.actor, false);
        const response = await this.applyInspectionEntries(
          aggregate,
          input.entries,
          input.actor,
          input.idempotencyKey,
          tx2,
        );
        return {
          response,
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: response.dispatchAttemptId ?? undefined,
        };
      },
      tx,
    );
  }

  private async applyInspectionEntries(
    aggregate: LockedDispatchAggregate,
    entries: Array<{ shipmentLineId: string; quantity: number }>,
    actor: ShipmentDispatchActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<ShipmentDispatchResponse> {
    let lastLineId = entries[entries.length - 1].shipmentLineId;
    let lastInspectedQty = 0;
    for (const entry of entries) {
      const line = aggregate.lines.find((candidate) => candidate.id === entry.shipmentLineId);
      if (!line) {
        throw this.conflict('SHIPMENT_INSPECTION_LINE_UNKNOWN', 'Shipment line does not belong to this shipment');
      }
      if (line.inspectedQty + entry.quantity > line.qty) {
        throw this.conflict('SHIPMENT_LINE_OVER_INSPECTED', 'Inspection quantity exceeds the shipment line');
      }
      await this.moveInspectionCustody(
        aggregate.session.id,
        line,
        entry.quantity,
        actor.id,
        `${idempotencyKey}:${line.id}`,
        tx,
      );
      const inspectedQty = line.inspectedQty + entry.quantity;
      await tx
        .update(wmsTables.shipmentLines)
        .set({ inspectedQty, lineVersion: line.lineVersion + 1 })
        .where(and(eq(wmsTables.shipmentLines.id, line.id), eq(wmsTables.shipmentLines.lineVersion, line.lineVersion)));
      line.inspectedQty = inspectedQty;
      line.lineVersion += 1;
      lastLineId = line.id;
      lastInspectedQty = inspectedQty;
    }

    if (aggregate.lines.every((candidate) => candidate.inspectedQty === candidate.qty)) {
      const dispatched = await this.dispatchLocked(aggregate, actor, tx);
      dispatched.shipmentLineId = lastLineId;
      dispatched.inspectedQty = lastInspectedQty;
      return dispatched;
    }
    return {
      shipmentId: aggregate.shipment.id,
      shipmentLineId: lastLineId,
      inspectedQty: lastInspectedQty,
      status: 'inspecting',
      dispatchAttemptId: null,
      attemptNo: null,
    };
  }
```

이어서 `forceDispatch`(234행)의 시그니처를 `async forceDispatch(shipmentId: string, input: ForceShipmentDispatchInput, tx?: DbTx)` 로 바꾸고, 그 안의 `this.commands.execute(...)` 호출 끝(닫는 `);` 직전)에 `tx,` 를 인자로 추가한다.

**주의**: `moveInspectionCustody` 의 내부 키가 `inspection:${idempotencyKey}:${balance.id}` 였다. 위에서 `${idempotencyKey}:${line.id}` 를 넘기므로 최종 키는 `inspection:<key>:<lineId>:<balanceId>` 가 되어 이전과 다르다. **같은 트랜잭션 안에서 여러 라인을 처리할 때 키가 충돌하지 않게 하려는 의도적 변경**이다(이전에는 한 호출에 한 라인이라 충돌이 없었다). 커밋된 옛 키와 겹치지 않으므로 재생 호환성 문제도 없다.

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/shipment-dispatch.integration.spec.ts`
Expected: PASS — 새 2건 포함 전량 통과

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment`
Expected: PASS — fulfillment 전체 회귀 그린 (실패 0)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts apps/core/src/modules/fulfillment/services/shipment-dispatch.integration.spec.ts
git commit -m "refactor(core): 검수를 라인 단위 진입점으로 추출하고 dispatch 에 tx 전달 허용

단순출고가 바코드 우회 없이 검수를 부르고 같은 트랜잭션을 공유할 수 있게
inspectShipmentLines 를 공개한다. inspectionScan 은 바코드 해석 래퍼로 남고
커스터디 이동·자동 dispatch 는 한 구현(applyInspectionEntries)만 유지한다."
```

---

### Task 3: `SimpleOutboundService` — 준비 단계

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `seedPickableShipment`, `OutboundBatchOrchestrator.claimPicker(workItemId, dto, idempotencyKey, actor, tx?)`, `PickingProcessService.plan(strategyName, input, tx?)` / `.start(input, tx?)`
- Produces:
  - `SimpleOutboundActor = { id: string; roles: string[] }`
  - `SimpleOutboundContext = { batchId: string; workItemId: string; shipmentId: string; planId: string; sessionId: string; leaseVersion: number }`
  - `SimpleOutboundService.prepare(shipmentId: string, actor: SimpleOutboundActor, idempotencyKey: string, tx: DbTx): Promise<SimpleOutboundContext>` (public — Task 4·6 이 소비)

- [ ] **Step 1: 실패하는 테스트 작성**

`simple-outbound.service.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { inRollbackTx, makeDb, seedPickableShipment } from './__support__';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { SimpleOutboundService } from './simple-outbound.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SimpleOutboundService.prepare', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('plan·session 을 만들고 피커 claim 까지 세운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const context = await service.prepare(fixture.shipmentId, actor, `prep-${randomUUID()}`, tx);

      expect(context.batchId).toBe(fixture.batchId);
      expect(context.workItemId).toBe(fixture.workItemId);
      expect(context.planId).toBeTruthy();
      expect(context.sessionId).toBeTruthy();

      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId))
        .limit(1);
      expect(workItem.status).toBe('picking');
      expect(workItem.pickerId).toBe(actor.id);
      expect(context.leaseVersion).toBe(workItem.leaseVersion);

      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.planId, context.planId))
        .limit(1);
      expect(allocation.shipmentLineId).toBe(fixture.shipmentLineId);
      expect(allocation.sourceLocationId).toBe(fixture.locationId);
      expect(allocation.qty).toBe(fixture.qty);
    });
  });

  it('두 번 불러도 같은 plan·session 을 재사용한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const first = await service.prepare(fixture.shipmentId, actor, `prep-a-${randomUUID()}`, tx);
      const second = await service.prepare(fixture.shipmentId, actor, `prep-b-${randomUUID()}`, tx);

      expect(second.planId).toBe(first.planId);
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.leaseVersion).toBe(first.leaseVersion);
    });
  });

  it('배치에 없는 shipment 는 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      await tx
        .delete(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId));
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.prepare(
          fixture.shipmentId,
          { id: fixture.actorId, roles: ['logistics_worker'] },
          `prep-${randomUUID()}`,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_WORK_ITEM_MISSING' } });
    });
  });

  it('다른 작업자가 피킹 중이면 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      const other = randomUUID();
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({
          status: 'picking',
          pickerId: other,
          pickerClaimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          leaseVersion: 1,
        })
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId));
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.prepare(
          fixture.shipmentId,
          { id: fixture.actorId, roles: ['logistics_worker'] },
          `prep-${randomUUID()}`,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER' } });
    });
  });
});
```

조립 헬퍼는 **테스트 전용 공유 파일** `services/__support__/simple-outbound-wiring.ts` 에 새로 만들고 스펙에서 import 한다(`import { ambientDbService, assembleSimpleOutbound } from './__support__/simple-outbound-wiring'` — `__support__/index.ts` 에도 `export * from './simple-outbound-wiring'` 를 추가한다). 스펙마다 조립을 복사하지 않기 위함이다 — 모듈 provider 가 바뀌면 고칠 곳이 한 곳이어야 한다.

`wireLogistics` 는 `PickingProcessService` 를 registry 없이(`@Optional()`) 만들어 전략을 쓸 수 없으므로, 여기서는 registry 를 직접 조립한다. `ambientDbService` 는 `shipment-dispatch.integration.spec.ts:50-55` 와 같은 패턴이다 — 호출자의 tx 를 그대로 쓰는 얇은 `DbService` 어댑터다. **이 파일의 `as unknown as` 캐스팅은 Global Constraints 의 예외로 허용된다**(테스트 헬퍼 한정, 기존 spec 전례와 동일). 프로덕션 코드에는 여전히 금지다.

`simple-outbound-wiring.ts` 전문:

```ts
export function ambientDbService(tx: DbTx): DbService<typeof wmsSchema> {
  return {
    db: tx,
    run: <T>(fn: (trx: DbTx) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as DbService<typeof wmsSchema>;
}

export function assembleSimpleOutbound(tx: DbTx): SimpleOutboundService {
  const dbService = ambientDbService(tx);
  const workflowGate = new FulfillmentWorkflowGate(
    new ConfigService({
      FULFILLMENT_WORKFLOW_MODE: 'v2',
      FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z',
    }),
  );
  const commands = new FulfillmentCommandService(dbService);
  const invariant = new FulfillmentInvariantService();
  const audit = new AuditService(dbService);
  const controlled = new BatchControlledStockGuard();
  const sessions = new BatchInventorySessionService(dbService, controlled, audit);
  const invOutbox = new InventoryOutboxService(dbService);
  const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
  const eventStore = new StockEventStore(dbService, sellable, controlled);
  const inventory = new InventoryCommandService(
    dbService,
    eventStore,
    invOutbox,
    new LocationService(dbService),
    controlled,
  );
  const unified = new UnifiedReservationService(dbService, sellable);
  const shipmentReservations = new ShipmentReservationService(
    dbService,
    unified,
    new FulfillmentProgressService(),
    invariant,
  );
  // dispatch·picking 은 WaybillService 의 읽기/CAS 만 소비한다 — carrier registry·issue
  // machine 은 이 경로에서 호출되지 않아 stub 으로 충분(waybill.manager.integration.spec 패턴).
  const waybills = new WaybillService(
    new WaybillManager(
      new WaybillReader(dbService),
      new WaybillRepository(dbService),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dbService,
    ),
  );
  // orchestrator 의 moduleRef 는 대기 오퍼레이션 재개(ConsolidationService)에만 쓰인다.
  // 단순출고 경로는 그 분기에 닿지 않으므로 no-op stub 이면 된다.
  const moduleRef = { get: () => ({ resumePending: async () => {} }) } as never;
  const batches = new OutboundBatchOrchestrator(
    dbService,
    commands,
    invariant,
    waybills,
    audit,
    workflowGate,
    moduleRef,
  );
  const discrete = new DiscretePickingStrategy(
    dbService,
    commands,
    workflowGate,
    invariant,
    sessions,
    controlled,
    waybills,
    batches,
  );
  const picking = new PickingProcessService(dbService, new PickingStrategyRegistry(dbService, [discrete]));
  const dispatch = new ShipmentDispatchService(
    dbService,
    commands,
    inventory,
    sessions,
    shipmentReservations,
    waybills,
    new BarcodeService(dbService),
    fulfillmentOutbox,
    audit,
    workflowGate,
  );
  return new SimpleOutboundService(dbService, batches, picking, workflowGate, commands, dispatch);
}
```

import 는 위 생성자에 맞춰 채운다(대부분 `shipment-dispatch.integration.spec.ts` 상단과 동일하다). 생성자 인자 순서가 틀리면 TypeScript 가 잡는다 — 맞추는 기준은 항상 각 서비스의 실제 `constructor` 다.

스펙에서는 `const service = assembleSimpleOutbound(tx);` 로 쓴다. **Task 4·5·6·7 의 테스트도 이 헬퍼를 그대로 재사용한다** — 조립 코드를 다시 쓰지 않는다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`
Expected: FAIL — `Cannot find module './simple-outbound.service'`

- [ ] **Step 3: 서비스 구현 (prepare 만)**

`simple-outbound.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { PickingProcessService } from './picking-process.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';

export interface SimpleOutboundActor {
  id: string;
  roles: string[];
}

export interface SimpleOutboundContext {
  batchId: string;
  workItemId: string;
  shipmentId: string;
  planId: string;
  sessionId: string;
  leaseVersion: number;
}

const PICKABLE_WORK_ITEM_STATUSES = ['queued', 'picking', 'ready_to_pack', 'packing'] as const;

@Injectable()
export class SimpleOutboundService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly batches: OutboundBatchOrchestrator,
    private readonly picking: PickingProcessService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  /**
   * 단순출고 스캔이 성립하기 위한 선행 상태를 확보한다 — 배치 work item 확인,
   * plan·session 생성(없을 때만), 피커 claim. 모두 호출자의 트랜잭션 안에서 돈다.
   */
  async prepare(
    shipmentId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<SimpleOutboundContext> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.prepare');
    const workItem = await this.loadWorkItem(shipmentId, tx);
    const planId = await this.ensurePlan(workItem.batchId, actor, idempotencyKey, tx);
    const sessionId = await this.ensureSession(workItem.batchId, planId, actor, idempotencyKey, tx);
    const leaseVersion = await this.ensurePickerClaim(workItem, actor, idempotencyKey, tx);
    return {
      batchId: workItem.batchId,
      workItemId: workItem.id,
      shipmentId,
      planId,
      sessionId,
      leaseVersion,
    };
  }

  private async loadWorkItem(shipmentId: string, tx: DbTx) {
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...PICKABLE_WORK_ITEM_STATUSES]),
        ),
      )
      .limit(1)
      .for('update');
    if (!workItem) {
      throw this.conflict(
        'SIMPLE_OUTBOUND_WORK_ITEM_MISSING',
        'Shipment is not part of an open outbound batch — ask the manager to add it',
      );
    }
    return workItem;
  }

  private async ensurePlan(
    batchId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<string> {
    const [existing] = await tx
      .select({ id: wmsTables.pickingPlans.id })
      .from(wmsTables.pickingPlans)
      .where(and(eq(wmsTables.pickingPlans.batchId, batchId), inArray(wmsTables.pickingPlans.status, ['draft', 'active'])))
      .limit(1);
    if (existing) return existing.id;

    const members = await tx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...PICKABLE_WORK_ITEM_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.outboundBatchWorkItems.shipmentId));
    const planned = await this.picking.plan(
      'discrete',
      {
        batchId,
        shipmentIds: members.map((member) => member.shipmentId),
        actorId: actor.id,
        idempotencyKey: `simple:${idempotencyKey}:plan`,
      },
      tx,
    );
    if (planned.state !== 'planned') {
      throw this.conflict('SIMPLE_OUTBOUND_PLAN_INVALIDATED', planned.reason);
    }
    return planned.planId;
  }

  private async ensureSession(
    batchId: string,
    planId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<string> {
    const [existing] = await tx
      .select({ id: wmsTables.batchInventorySessions.id })
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, batchId),
          eq(wmsTables.batchInventorySessions.status, 'active'),
        ),
      )
      .limit(1);
    if (existing) return existing.id;

    const started = await this.picking.start(
      { batchId, planId, actorId: actor.id, idempotencyKey: `simple:${idempotencyKey}:start` },
      tx,
    );
    if (started.state !== 'started') {
      throw this.conflict('SIMPLE_OUTBOUND_PLAN_INVALIDATED', started.reason);
    }
    return started.sessionId;
  }

  private async ensurePickerClaim(
    workItem: typeof wmsTables.outboundBatchWorkItems.$inferSelect,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<number> {
    const leaseActive = workItem.leaseExpiresAt !== null && workItem.leaseExpiresAt.getTime() > Date.now();
    if (workItem.pickerId && workItem.pickerId !== actor.id && !workItem.pickerReleasedAt && leaseActive) {
      throw this.conflict('SIMPLE_OUTBOUND_CLAIMED_BY_OTHER', 'Another worker is already picking this shipment');
    }
    // 내 것이면서 리스가 아직 살아있을 때만 짧은 경로. 만료(15분, LEASE_MS)됐으면 조용히 다시 claim 해
    // 리스를 연장한다 — 안 그러면 prepare 는 성공을 돌려주는데 이어지는 피킹 스캔이
    // `lockAndAssertPickerClaim` 의 만료 검사(discrete-picking.strategy.ts:821-822)에서 거부된다.
    // claim 의 CAS 는 `소유자 없음 OR leaseExpiresAt <= now`(outbound-batch-orchestrator.service.ts:694-697)
    // 라 만료된 자기 소유 재-claim 이 허용된다. 그 사이 남이 가져갔으면 위 가드가 CLAIMED_BY_OTHER 로 막는다.
    if (workItem.pickerId === actor.id && workItem.status !== 'queued' && leaseActive) {
      return workItem.leaseVersion;
    }

    const claimed = await this.batches.claimPicker(
      workItem.id,
      { expectedLeaseVersion: workItem.leaseVersion },
      `simple:${idempotencyKey}:claim-picker`,
      { id: actor.id, roles: actor.roles },
      tx,
    );
    return claimed.workItem.leaseVersion;
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
```

생성자에는 Task 4·5 에서 쓸 의존성(`FulfillmentCommandService`, `ShipmentDispatchService`)까지 지금 함께 선언해 둔다 — 조립 코드를 세 번 고치지 않기 위함이다. `prepare` 만 구현한 상태에서는 아직 쓰이지 않는다:

```ts
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly batches: OutboundBatchOrchestrator,
    private readonly picking: PickingProcessService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly commands: FulfillmentCommandService,
    private readonly dispatch: ShipmentDispatchService,
  ) {}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/simple-outbound.service.ts apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts
git commit -m "feat(core): 단순출고 준비 단계 — plan·session 확보와 피커 claim"
```

---

### Task 4: 스캔 — 할당 분배 피킹

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 `prepare`, `PickingProcessService.scan(input, tx?)`
- Produces:
  - `SimpleOutboundLineProgress = { shipmentLineId: string; skuId: string; qty: number; pickedQty: number; inspectedQty: number }`
  - `SimpleOutboundState = { shipmentId: string; workItemStatus: string; status: 'in_progress' | 'shipped'; dispatchAttemptId: string | null; lines: SimpleOutboundLineProgress[] }`
  - `SimpleOutboundService.scan(shipmentId: string, input: { barcode: string; quantity: number; actor: SimpleOutboundActor; idempotencyKey: string }, tx?: DbTx): Promise<SimpleOutboundState>`

이 태스크는 **피킹만** 한다 — 전량 피킹 시의 완료·검수는 Task 5 다. 그래서 이 태스크의 테스트는 부분 스캔 후 `pickedQty` 만 확인한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`simple-outbound.service.integration.spec.ts` 에 새 `describeIfDb` 블록을 추가한다(같은 파일, `prepare` 블록 아래):

```ts
describeIfDb('SimpleOutboundService.scan — 피킹', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('바코드 1개 스캔이 그 라인의 pickedQty 를 올린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);

      const state = await service.scan(
        fixture.shipmentId,
        {
          barcode: fixture.barcode,
          quantity: 1,
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: `scan-${randomUUID()}`,
        },
        tx,
      );

      expect(state.status).toBe('in_progress');
      expect(state.lines).toEqual([
        { shipmentLineId: fixture.shipmentLineId, skuId: fixture.skuId, qty: 2, pickedQty: 1, inspectedQty: 0 },
      ]);
    });
  });

  it('필요 수량을 넘는 스캔은 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      await expect(
        service.scan(
          fixture.shipmentId,
          { barcode: fixture.barcode, quantity: 3, actor, idempotencyKey: `scan-${randomUUID()}` },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_OVERSCAN' } });
    });
  });

  it('이 송장에 없는 바코드는 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const other = await seedPickableShipment(tx, 1);
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.scan(
          fixture.shipmentId,
          {
            barcode: other.barcode,
            quantity: 1,
            actor: { id: fixture.actorId, roles: ['logistics_worker'] },
            idempotencyKey: `scan-${randomUUID()}`,
          },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT' } });
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts -t 피킹`
Expected: FAIL — `service.scan is not a function`

- [ ] **Step 3: 구현**

`simple-outbound.service.ts` 에 타입과 메서드를 추가한다. 생성자는 Task 3 에서 이미 `commands`·`dispatch` 까지 선언했으므로 그대로 쓴다. `BadRequestException` import 를 보강한다.

```ts
export interface SimpleOutboundLineProgress {
  shipmentLineId: string;
  skuId: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export interface SimpleOutboundState {
  shipmentId: string;
  workItemStatus: string;
  status: 'in_progress' | 'shipped';
  dispatchAttemptId: string | null;
  lines: SimpleOutboundLineProgress[];
}

  async scan(
    shipmentId: string,
    input: { barcode: string; quantity: number; actor: SimpleOutboundActor; idempotencyKey: string },
    tx?: DbTx,
  ): Promise<SimpleOutboundState> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.scan');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    return this.commands.execute<SimpleOutboundState>(
      {
        commandType: 'shipment.simple_outbound.scan',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          barcode: input.barcode.trim(),
          quantity: input.quantity,
          actorId: input.actor.id,
        },
      },
      async (trx) => {
        const context = await this.prepare(shipmentId, input.actor, input.idempotencyKey, trx);
        const skuId = await this.resolveSkuId(input.barcode, trx);
        await this.pickScanned(context, skuId, input.quantity, input.actor, input.idempotencyKey, trx);
        const state = await this.loadState(context, trx);
        return { response: state, resourceType: 'shipment', resourceId: shipmentId };
      },
      tx,
    );
  }

  /**
   * 바코드 → SKU.
   *
   * **2026-07-27 정정(리뷰 결과, 사용자 결정)**: 아래 2단계 구현은 검수의 4단계
   * (`sku_barcodes` → `sku:<uuid>` → 맨 UUID → `skus.code`)와 달라서, 우리가 발행한 SKU QR
   * 라벨이 검수에서는 먹고 피킹에서는 튕기는 불일치를 만들었다. 해석 규칙을 공유 헬퍼
   * `resolveSkuIdByBarcode(barcodes, barcode, tx)` 로 추출해 검수(`resolveInspectionLine`)와
   * 단순출고가 **같은 함수**를 쓴다. 헬퍼는 못 찾으면 `null` 을 돌려주고, 도메인 오류
   * (`SHIPMENT_INSPECTION_BARCODE_UNKNOWN` / `SIMPLE_OUTBOUND_BARCODE_UNKNOWN`)는 각 호출자가 던진다.
   */
  private async resolveSkuId(barcode: string, tx: DbTx): Promise<string> {
    const normalized = barcode.trim();
    if (!normalized) throw new BadRequestException('barcode is required');
    const [registered] = await tx
      .select({ skuId: wmsTables.skuBarcodes.skuId })
      .from(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.barcode, normalized))
      .limit(1);
    if (registered) return registered.skuId;
    const [sku] = await tx
      .select({ id: wmsTables.skus.id })
      .from(wmsTables.skus)
      .where(eq(wmsTables.skus.code, normalized))
      .limit(1);
    if (!sku) throw this.conflict('SIMPLE_OUTBOUND_BARCODE_UNKNOWN', 'Barcode does not resolve to a SKU');
    return sku.id;
  }

  /**
   * 스캔 수량을 이 SKU 의 할당(allocation)들에 나눠 담는다. 한 라인이 여러
   * 로케이션에서 나올 수 있고(unique 키가 plan+line+location), 전략의 과다피킹
   * 가드도 로케이션 단위라 분배가 필요하다.
   */
  private async pickScanned(
    context: SimpleOutboundContext,
    skuId: string,
    quantity: number,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<void> {
    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, context.planId),
          eq(wmsTables.shipmentLines.shipmentId, context.shipmentId),
          eq(wmsTables.shipmentLines.skuId, skuId),
        ),
      )
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );
    if (allocations.length === 0) {
      throw this.conflict('SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT', 'Scanned SKU does not belong to this shipment');
    }

    let remaining = quantity;
    for (const allocation of allocations) {
      if (remaining === 0) break;
      const attributed = await this.attributedQty(
        context.sessionId,
        allocation.shipmentLineId,
        allocation.sourceLocationId,
        tx,
      );
      const free = allocation.qty - attributed;
      if (free <= 0) continue;
      const take = Math.min(free, remaining);
      await this.picking.scan(
        {
          strategy: 'discrete',
          stage: 'source',
          batchId: context.batchId,
          planId: context.planId,
          sessionId: context.sessionId,
          workItemId: context.workItemId,
          shipmentId: context.shipmentId,
          shipmentLineId: allocation.shipmentLineId,
          skuId,
          sourceLocationId: allocation.sourceLocationId,
          quantity: take,
          actor: { id: actor.id, roles: actor.roles },
          expectedLeaseVersion: context.leaseVersion,
          idempotencyKey: `simple:${idempotencyKey}:pick:${allocation.id}`,
        },
        tx,
      );
      remaining -= take;
    }
    if (remaining > 0) {
      throw this.conflict(
        'SIMPLE_OUTBOUND_OVERSCAN',
        `Scan exceeds the remaining quantity for this shipment by ${remaining}`,
      );
    }
  }

  /** 전략의 과다피킹 가드와 같은 집계 — SETTLED 를 제외한 커스터디 합계. */
  private async attributedQty(
    sessionId: string,
    shipmentLineId: string,
    sourceLocationId: string,
    tx: DbTx,
  ): Promise<number> {
    const [row] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, sourceLocationId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    return Number(row?.qty ?? 0);
  }

  private async loadState(context: SimpleOutboundContext, tx: DbTx): Promise<SimpleOutboundState> {
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        inspectedQty: wmsTables.shipmentLines.inspectedQty,
      })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, context.shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    const progress: SimpleOutboundLineProgress[] = [];
    for (const line of lines) {
      const [row] = await tx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, context.sessionId),
            eq(wmsTables.batchInventorySessionBalances.shipmentLineId, line.id),
            ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
          ),
        );
      progress.push({
        shipmentLineId: line.id,
        skuId: line.skuId,
        qty: line.qty,
        pickedQty: Math.max(Number(row?.qty ?? 0), line.inspectedQty),
        inspectedQty: line.inspectedQty,
      });
    }
    const [workItem] = await tx
      .select({ status: wmsTables.outboundBatchWorkItems.status })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
      .limit(1);
    const [shipment] = await tx
      .select({ status: wmsTables.shipments.status })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, context.shipmentId))
      .limit(1);
    return {
      shipmentId: context.shipmentId,
      workItemStatus: workItem?.status ?? 'unknown',
      status: shipment?.status === 'shipped' ? 'shipped' : 'in_progress',
      dispatchAttemptId: null,
      lines: progress,
    };
  }
```

`pickedQty` 에 `Math.max(…, inspectedQty)` 를 쓰는 이유: dispatch 가 커스터디를 `SETTLED` 로 정산하면 합계가 0 으로 떨어진다. 출고완료 후에도 화면이 "2/2 집품"으로 보이게 하려면 검수 수량을 하한으로 둔다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`
Expected: PASS (7 passed)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/simple-outbound.service.ts apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts
git commit -m "feat(core): 단순출고 스캔 — 할당 분배 피킹과 라인 진행 반환"
```

---

### Task 5: 스캔 완결 — 완료·패커 claim·검수·자동 출고

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 `ShipmentDispatchService.inspectShipmentLines`, Task 4 `scan`, `PickingProcessService.completePick(input, tx?)`, `OutboundBatchOrchestrator.claimPacker(...)`
- Produces: `scan` 이 전량 스캔 시 `status: 'shipped'` + `dispatchAttemptId` 를 채운 `SimpleOutboundState` 를 반환

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
  it('마지막 스캔에서 완료·검수·출고까지 한 번에 끝난다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const first = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-a-${randomUUID()}` },
        tx,
      );
      expect(first.status).toBe('in_progress');

      const second = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-b-${randomUUID()}` },
        tx,
      );

      expect(second.status).toBe('shipped');
      expect(second.dispatchAttemptId).not.toBeNull();
      expect(second.lines[0]).toMatchObject({ qty: 2, pickedQty: 2, inspectedQty: 2 });

      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipmentId))
        .limit(1);
      expect(shipment.status).toBe('shipped');
    });
  });

  it('한 번 스캔으로 전량이면 그 스캔에서 바로 출고된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);

      const state = await service.scan(
        fixture.shipmentId,
        {
          barcode: fixture.barcode,
          quantity: 2,
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: `scan-${randomUUID()}`,
        },
        tx,
      );

      expect(state.status).toBe('shipped');
      expect(state.workItemStatus).toBe('completed');
    });
  });

  it('같은 idempotency-key 재요청은 이중 계상하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };
      const key = `scan-retry-${randomUUID()}`;

      const first = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: key },
        tx,
      );
      const replay = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: key },
        tx,
      );

      expect(replay).toEqual(first);
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
        .limit(1);
      expect(line.inspectedQty).toBe(0);
    });
  });
```

`workItemStatus` 기대값(`'completed'`)은 dispatch 가 work item 을 종결한 뒤의 상태다. 실행 중 다른 값이 나오면 **테스트를 고치지 말고** 실제 전이를 확인해 기대값을 실제 enum 값으로 맞춘다(`outboundBatchWorkItemStatusEnum` 참조).

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts -t 마지막`
Expected: FAIL — `expect(second.status).toBe('shipped')` 가 `'in_progress'` 를 받는다

- [ ] **Step 3: 구현**

생성자는 이미 `dispatch` 를 갖고 있다(Task 3). `scan` 의 핸들러에서 `loadState` 앞에 완결 처리를 넣는다:

```ts
      async (trx) => {
        const context = await this.prepare(shipmentId, input.actor, input.idempotencyKey, trx);
        const skuId = await this.resolveSkuId(input.barcode, trx);
        await this.pickScanned(context, skuId, input.quantity, input.actor, input.idempotencyKey, trx);
        const settled = await this.settleIfFullyPicked(context, input.actor, input.idempotencyKey, trx);
        const state = await this.loadState(context, trx);
        return {
          response: { ...state, dispatchAttemptId: settled?.dispatchAttemptId ?? null },
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: settled?.dispatchAttemptId ?? undefined,
        };
      },
```

그리고 메서드를 추가한다:

```ts
  /**
   * 박스 전 라인이 피킹됐으면 완료 → 패커 claim → 검수를 이어서 돈다. 검수는
   * 전략 밖(shipment-dispatch)이고 완료(HAND_IN·ready_to_pack) 이후에만 성립하므로
   * 라인별로 교차할 수 없다 — 그래서 여기서 한 번에 재생한다.
   */
  private async settleIfFullyPicked(
    context: SimpleOutboundContext,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<{ dispatchAttemptId: string | null } | null> {
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        qty: wmsTables.shipmentLines.qty,
        inspectedQty: wmsTables.shipmentLines.inspectedQty,
      })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, context.shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));

    const pending: Array<{ shipmentLineId: string; quantity: number }> = [];
    for (const line of lines) {
      const [row] = await tx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, context.sessionId),
            eq(wmsTables.batchInventorySessionBalances.shipmentLineId, line.id),
            ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
          ),
        );
      const picked = Number(row?.qty ?? 0);
      if (picked < line.qty) return null; // 아직 남았다 — 완료하지 않는다
      if (line.inspectedQty < line.qty) {
        pending.push({ shipmentLineId: line.id, quantity: line.qty - line.inspectedQty });
      }
    }
    if (pending.length === 0) return null;

    const [beforeComplete] = await tx
      .select({ status: wmsTables.outboundBatchWorkItems.status, leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
      .limit(1);
    if (beforeComplete?.status === 'picking') {
      await this.picking.completePick(
        {
          batchId: context.batchId,
          planId: context.planId,
          sessionId: context.sessionId,
          workItemId: context.workItemId,
          shipmentId: context.shipmentId,
          actor: { id: actor.id, roles: actor.roles },
          expectedLeaseVersion: beforeComplete.leaseVersion,
          idempotencyKey: `simple:${idempotencyKey}:complete`,
        },
        tx,
      );
    }

    const [beforePack] = await tx
      .select({ status: wmsTables.outboundBatchWorkItems.status, leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
      .limit(1);
    if (beforePack?.status === 'ready_to_pack') {
      await this.batches.claimPacker(
        context.workItemId,
        { expectedLeaseVersion: beforePack.leaseVersion },
        `simple:${idempotencyKey}:claim-packer`,
        { id: actor.id, roles: actor.roles },
        tx,
      );
    }

    const inspected = await this.dispatch.inspectShipmentLines(
      context.shipmentId,
      {
        entries: pending,
        actor: { id: actor.id, roles: actor.roles },
        idempotencyKey: `simple:${idempotencyKey}:inspect`,
      },
      tx,
    );
    return { dispatchAttemptId: inspected.dispatchAttemptId };
  }
```

- [ ] **Step 4: 테스트 통과 + 회귀**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`
Expected: PASS (10 passed)

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment`
Expected: PASS — fulfillment 전체 그린

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/simple-outbound.service.ts apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts
git commit -m "feat(core): 단순출고 완결 — 전량 피킹 시 완료·패커 claim·검수·자동 출고"
```

---

### Task 6: 강제완료 (`forceComplete`)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`

**Interfaces:**
- Consumes: Task 5 `settleIfFullyPicked` 의 보조 메서드들, `ShipmentDispatchService.forceDispatch(shipmentId, input, tx?)`
- Produces: `SimpleOutboundService.forceComplete(shipmentId: string, input: { reason: string; csCaseId?: string; note?: string; actor: SimpleOutboundActor; idempotencyKey: string; authorization: ScopeAuthorizationDecision | undefined }, tx?: DbTx): Promise<SimpleOutboundState>`

미피킹 라인이 남은 박스는 `completePick` 이 안 되므로 기존 `force-dispatch` 만으로 레거시의 "모두 스캔한 것으로 처리"를 할 수 없다. 남은 수량을 할당 로케이션 기준으로 강제 피킹한 뒤 완료하고, dispatch 는 `forceDispatch` 에 맡긴다(권한 검사·감사 로그가 거기 있다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describeIfDb('SimpleOutboundService.forceComplete', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const authorization = {
    scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
    granted: true,
  } as unknown as ScopeAuthorizationDecision;

  it('미피킹 수량을 강제로 채워 출고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );

      const state = await service.forceComplete(
        fixture.shipmentId,
        {
          reason: '재고 실물 확인 후 스캔 생략',
          actor,
          idempotencyKey: `force-${randomUUID()}`,
          authorization,
        },
        tx,
      );

      expect(state.status).toBe('shipped');
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
        .limit(1);
      expect(line.inspectedQty).toBe(2);
      expect(line.forced).toBe(true);
    });
  });

  it('강제출고 스코프가 없으면 403 이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 1);
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.forceComplete(
          fixture.shipmentId,
          {
            reason: '권한 없음 확인',
            actor: { id: fixture.actorId, roles: ['logistics_worker'] },
            idempotencyKey: `force-${randomUUID()}`,
            authorization: undefined,
          },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_DISPATCH_FORCE_FORBIDDEN' } });
    });
  });
});
```

`authorization` 목의 실제 형태는 `isScopeAuthorizationDecision`(`@app/authorization`)이 요구하는 필드를 따라야 한다. 구현 전에 그 타입 가드를 읽고 필드를 채운다 — 통과하지 않으면 첫 테스트가 403 으로 실패한다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts -t forceComplete`
Expected: FAIL — `service.forceComplete is not a function`

- [ ] **Step 3: 구현**

```ts
  async forceComplete(
    shipmentId: string,
    input: {
      reason: string;
      csCaseId?: string;
      note?: string;
      actor: SimpleOutboundActor;
      idempotencyKey: string;
      authorization: ScopeAuthorizationDecision | undefined;
    },
    tx?: DbTx,
  ): Promise<SimpleOutboundState> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.force');
    if (!input.reason.trim()) throw new BadRequestException('reason is required');
    return this.commands.execute<SimpleOutboundState>(
      {
        commandType: 'shipment.simple_outbound.force',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          reason: input.reason.trim(),
          csCaseId: input.csCaseId?.trim() || null,
          note: input.note?.trim() || null,
          actorId: input.actor.id,
        },
      },
      async (trx) => {
        const context = await this.prepare(shipmentId, input.actor, input.idempotencyKey, trx);
        await this.forcePickRemaining(context, input.actor, input.idempotencyKey, trx);
        const [workItem] = await trx
          .select({
            status: wmsTables.outboundBatchWorkItems.status,
            leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion,
          })
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
          .limit(1);
        if (workItem?.status === 'picking') {
          await this.picking.completePick(
            {
              batchId: context.batchId,
              planId: context.planId,
              sessionId: context.sessionId,
              workItemId: context.workItemId,
              shipmentId: context.shipmentId,
              actor: { id: input.actor.id, roles: input.actor.roles },
              expectedLeaseVersion: workItem.leaseVersion,
              idempotencyKey: `simple:${input.idempotencyKey}:complete`,
            },
            trx,
          );
        }
        const forced = await this.dispatch.forceDispatch(
          context.shipmentId,
          {
            reason: input.reason,
            csCaseId: input.csCaseId,
            note: input.note,
            actor: { id: input.actor.id, roles: input.actor.roles },
            idempotencyKey: `simple:${input.idempotencyKey}:force`,
            authorization: input.authorization,
          },
          trx,
        );
        const state = await this.loadState(context, trx);
        return {
          response: { ...state, dispatchAttemptId: forced.dispatchAttemptId },
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: forced.dispatchAttemptId ?? undefined,
        };
      },
      tx,
    );
  }

  /** 남은 필요 수량을 할당 로케이션 기준으로 채운다 — 작업자가 스캔을 생략한 몫이다. */
  private async forcePickRemaining(
    context: SimpleOutboundContext,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<void> {
    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, context.planId),
          eq(wmsTables.shipmentLines.shipmentId, context.shipmentId),
        ),
      )
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );

    for (const allocation of allocations) {
      const attributed = await this.attributedQty(
        context.sessionId,
        allocation.shipmentLineId,
        allocation.sourceLocationId,
        tx,
      );
      const missing = allocation.qty - attributed;
      if (missing <= 0) continue;
      await this.picking.scan(
        {
          strategy: 'discrete',
          stage: 'source',
          batchId: context.batchId,
          planId: context.planId,
          sessionId: context.sessionId,
          workItemId: context.workItemId,
          shipmentId: context.shipmentId,
          shipmentLineId: allocation.shipmentLineId,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          quantity: missing,
          actor: { id: actor.id, roles: actor.roles },
          expectedLeaseVersion: context.leaseVersion,
          idempotencyKey: `simple:${idempotencyKey}:force-pick:${allocation.id}`,
        },
        tx,
      );
    }
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`
Expected: PASS (12 passed)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/simple-outbound.service.ts apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts
git commit -m "feat(core): 단순출고 강제완료 — 미피킹 수량 강제 피킹 후 강제출고"
```

---

### Task 7: 운송장번호 조회 리더

**Files:**
- Create: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts`
- Test: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `seedPickableShipment`
- Produces: `ShipmentWaybillReader.byTrackingNo(trackingNo: string): Promise<ShipmentByWaybillResult>` where
  `ShipmentByWaybillResult = { shipmentId: string; trackingNo: string; carrier: string; waybillStatus: string; shipmentStatus: string; batchId: string | null; workItemId: string | null; workItemStatus: string | null; recipientMasked: string; lines: Array<{ shipmentLineId: string; skuId: string; skuCode: string; skuName: string; qty: number; inspectedQty: number }> }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { eq } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from '../services/__support__';
import { ShipmentWaybillReader } from './shipment-waybill.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// ambientDbService 는 Task 3 에서 만든 __support__/simple-outbound-wiring.ts 에서 가져온다.
describeIfDb('ShipmentWaybillReader', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('운송장번호로 박스와 라인 진행을 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const reader = new ShipmentWaybillReader(ambientDbService(tx));

      const result = await reader.byTrackingNo(fixture.trackingNo);

      expect(result.shipmentId).toBe(fixture.shipmentId);
      expect(result.carrier).toBe('HANJIN');
      expect(result.batchId).toBe(fixture.batchId);
      expect(result.workItemId).toBe(fixture.workItemId);
      expect(result.workItemStatus).toBe('queued');
      expect(result.recipientMasked).toBe('Simple T**');
      expect(result.lines).toEqual([
        {
          shipmentLineId: fixture.shipmentLineId,
          skuId: fixture.skuId,
          skuCode: fixture.skuCode,
          skuName: 'Simple SKU',
          qty: 2,
          inspectedQty: 0,
        },
      ]);
    });
  });

  it('없는 운송장번호는 404 다', async () => {
    await inRollbackTx(db, async (tx) => {
      const reader = new ShipmentWaybillReader(ambientDbService(tx));
      await expect(reader.byTrackingNo('NO-SUCH-TRACK')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('무효화된 운송장은 404 다 — 종결 상태는 작업 대상이 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 1);
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, fixture.waybillId));
      const reader = new ShipmentWaybillReader(ambientDbService(tx));

      await expect(reader.byTrackingNo(fixture.trackingNo)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.integration.spec.ts`
Expected: FAIL — `Cannot find module './shipment-waybill.reader'`

- [ ] **Step 3: 구현**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  inspectedQty: number;
}

export interface ShipmentByWaybillResult {
  shipmentId: string;
  trackingNo: string;
  carrier: string;
  waybillStatus: string;
  shipmentStatus: string;
  batchId: string | null;
  workItemId: string | null;
  workItemStatus: string | null;
  recipientMasked: string;
  lines: ShipmentByWaybillLine[];
}

// 2026-07-27 정정(리뷰): 종결 2상태만 빼는 게 맞다. `short_pick_recovery` 도 활성 상태이며
// (uq_outbound_work_item_active_shipment 가 completed/excluded 만 제외한다) 작업자가 송장을 스캔했을 때
// 가장 보고 싶어하는 예외 상태다. 4개만 나열하면 그 박스가 "작업 없음" 으로 조용히 보고된다.
const TERMINAL_WORK_ITEM_STATUSES = ['completed', 'excluded'] as const;

/** 이름은 뒤 절반을 가린다 — 현장 화면에 개인정보를 통째로 띄우지 않는다. */
function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  const keep = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, keep)}${'*'.repeat(trimmed.length - keep)}`;
}

@Injectable()
export class ShipmentWaybillReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async byTrackingNo(trackingNo: string): Promise<ShipmentByWaybillResult> {
    const normalized = trackingNo.trim();
    return this.dbService.run(async (trx) => {
      const [waybill] = await trx
        .select({
          shipmentId: wmsTables.waybills.shipmentId,
          trackingNo: wmsTables.waybills.trackingNo,
          carrier: wmsTables.waybills.carrier,
          status: wmsTables.waybills.status,
        })
        .from(wmsTables.waybills)
        .where(
          and(
            eq(wmsTables.waybills.trackingNo, normalized),
            notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
          ),
        )
        .limit(1);
      if (!waybill) throw new NotFoundException(`Waybill not found for tracking number ${normalized}`);

      const [shipment] = await trx
        .select({ status: wmsTables.shipments.status, recipientSnapshot: wmsTables.shipments.recipientSnapshot })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, waybill.shipmentId))
        .limit(1);
      if (!shipment) throw new NotFoundException(`Shipment ${waybill.shipmentId} not found`);

      const [workItem] = await trx
        .select({
          id: wmsTables.outboundBatchWorkItems.id,
          batchId: wmsTables.outboundBatchWorkItems.batchId,
          status: wmsTables.outboundBatchWorkItems.status,
        })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.shipmentId, waybill.shipmentId),
            inArray(wmsTables.outboundBatchWorkItems.status, [...OPEN_WORK_ITEM_STATUSES]),
          ),
        )
        .limit(1);

      const lines = await trx
        .select({
          shipmentLineId: wmsTables.shipmentLines.id,
          skuId: wmsTables.shipmentLines.skuId,
          skuCode: wmsTables.skus.code,
          skuName: wmsTables.skus.name,
          qty: wmsTables.shipmentLines.qty,
          inspectedQty: wmsTables.shipmentLines.inspectedQty,
        })
        .from(wmsTables.shipmentLines)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
        .where(eq(wmsTables.shipmentLines.shipmentId, waybill.shipmentId))
        .orderBy(asc(wmsTables.shipmentLines.id));

      // 2026-07-27 정정(리뷰): jsonb 를 `as` 로 단정하지 않는다 — Global Constraints 의 캐스팅 금지가
      // 이 코드보다 우선한다. 좁히기 함수로 읽는다.
      const snapshot = readRecipientName(shipment.recipientSnapshot);
      return {
        shipmentId: waybill.shipmentId,
        trackingNo: waybill.trackingNo ?? normalized,
        carrier: waybill.carrier,
        waybillStatus: waybill.status,
        shipmentStatus: shipment.status,
        batchId: workItem?.batchId ?? null,
        workItemId: workItem?.id ?? null,
        workItemStatus: workItem?.status ?? null,
        recipientMasked: maskName(snapshot),
        lines,
      };
    });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.integration.spec.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/reader/
git commit -m "feat(core): 운송장번호로 박스·라인 진행을 찾는 조회 리더 추가"
```

---

### Task 8: 컨트롤러 + DTO + 모듈 배선

**Files:**
- Create: `apps/core/src/modules/fulfillment/dto/simple-outbound.dto.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.ts`
- Test: `apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`

**Interfaces:**
- Consumes: Task 5·6 `SimpleOutboundService.scan`/`forceComplete`, Task 7 `ShipmentWaybillReader.byTrackingNo`
- Produces: HTTP 계약
  - `GET /shipments/by-waybill?trackingNo=…` → `ShipmentByWaybillResult`
  - `POST /shipments/:shipmentId/simple-outbound-scans` (헤더 `Idempotency-Key`, 바디 `{ barcode, quantity }`) → `SimpleOutboundState`
  - `POST /shipments/:shipmentId/simple-outbound-forces` (헤더 `Idempotency-Key`, 바디 `{ reason, csCaseId?, note? }`) → `SimpleOutboundState`

- [ ] **Step 1: 실패하는 테스트 작성**

`simple-outbound.controller.spec.ts` — 컨트롤러는 위임만 하므로 서비스를 목한다. 기존 `picking-v2.controller.spec.ts` 의 스타일을 따른다.

```ts
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SimpleOutboundController } from './simple-outbound.controller';

describe('SimpleOutboundController', () => {
  const state = { shipmentId: 's-1', workItemStatus: 'picking', status: 'in_progress', dispatchAttemptId: null, lines: [] };

  function build() {
    const service = { scan: jest.fn().mockResolvedValue(state), forceComplete: jest.fn().mockResolvedValue(state) };
    const reader = { byTrackingNo: jest.fn().mockResolvedValue({ shipmentId: 's-1' }) };
    return { service, reader, controller: new SimpleOutboundController(service as never, reader as never) };
  }

  it('스캔은 actor·idempotencyKey 를 채워 서비스에 위임한다', async () => {
    const { service, controller } = build();
    await controller.scan('s-1', { barcode: '8801', quantity: 2 }, 'key-1', { userId: 'u-1', roles: ['warehouse'] });
    expect(service.scan).toHaveBeenCalledWith('s-1', {
      barcode: '8801',
      quantity: 2,
      actor: { id: 'u-1', roles: ['warehouse'] },
      idempotencyKey: 'key-1',
    });
  });

  it('Idempotency-Key 가 없으면 400 이다', async () => {
    const { controller } = build();
    await expect(
      controller.scan('s-1', { barcode: '8801', quantity: 1 }, undefined, { userId: 'u-1', roles: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('인증 주체가 없으면 401 이다', async () => {
    const { controller } = build();
    await expect(controller.scan('s-1', { barcode: '8801', quantity: 1 }, 'key-1', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('trackingNo 없이 조회하면 400 이다', async () => {
    const { controller } = build();
    await expect(controller.byWaybill('')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.spec.ts`
Expected: FAIL — `Cannot find module './simple-outbound.controller'`

- [ ] **Step 3: DTO·컨트롤러 구현 + 모듈 등록**

`dto/simple-outbound.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class SimpleOutboundScanDto {
  @IsString()
  @IsNotEmpty()
  barcode: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class ForceSimpleOutboundDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  csCaseId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SimpleOutboundLineProgressDto {
  shipmentLineId: string;
  skuId: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export class SimpleOutboundStateDto {
  shipmentId: string;
  workItemStatus: string;

  @ApiProperty({ enum: ['in_progress', 'shipped'] })
  status: 'in_progress' | 'shipped';

  @ApiPropertyOptional({ nullable: true })
  dispatchAttemptId: string | null;

  @ApiProperty({ type: [SimpleOutboundLineProgressDto] })
  lines: SimpleOutboundLineProgressDto[];
}
```

`controllers/simple-outbound.controller.ts` — 스코프는 스캔이 `WAREHOUSE_OPERATE`, 강제완료가 `DISPATCH_FORCE` 다. 강제완료는 `getScopeAuthorizationDecision` 결과를 서비스에 넘긴다(`shipment.controller.ts:81` 의 force-dispatch 패턴을 그대로 따른다).

```ts
import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getScopeAuthorizationDecision, RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ForceSimpleOutboundDto, SimpleOutboundScanDto, SimpleOutboundStateDto } from '../dto/simple-outbound.dto';
import { ShipmentWaybillReader, ShipmentByWaybillResult } from '../reader/shipment-waybill.reader';
import { SimpleOutboundService } from '../services/simple-outbound.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

@ApiTags('Shipments')
@Controller('shipments')
@UseGuards(ScopeGuard)
export class SimpleOutboundController {
  constructor(
    private readonly simpleOutbound: SimpleOutboundService,
    private readonly waybills: ShipmentWaybillReader,
  ) {}

  @Get('by-waybill')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: '운송장번호로 박스와 라인 진행 조회 (단순출고 진입점)' })
  byWaybill(@Query('trackingNo') trackingNo?: string): Promise<ShipmentByWaybillResult> {
    if (!trackingNo?.trim()) throw new BadRequestException('trackingNo is required');
    return this.waybills.byTrackingNo(trackingNo);
  }

  @Post(':shipmentId/simple-outbound-scans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: '단순출고 스캔 — 피킹·검수·자동 출고를 한 트랜잭션에서 처리' })
  scan(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: SimpleOutboundScanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<SimpleOutboundStateDto> {
    return this.simpleOutbound.scan(shipmentId, {
      barcode: dto.barcode,
      quantity: dto.quantity,
      actor: this.actor(user),
      idempotencyKey: this.idempotencyKey(idempotencyKey),
    });
  }

  @Post(':shipmentId/simple-outbound-forces')
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_FORCE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: '단순출고 강제완료 — 미피킹 수량을 채우고 강제 출고' })
  force(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ForceSimpleOutboundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
    @Req() request: unknown,
  ): Promise<SimpleOutboundStateDto> {
    return this.simpleOutbound.forceComplete(shipmentId, {
      reason: dto.reason,
      csCaseId: dto.csCaseId,
      note: dto.note,
      actor: this.actor(user),
      idempotencyKey: this.idempotencyKey(idempotencyKey),
      authorization: getScopeAuthorizationDecision(request as never),
    });
  }

  private actor(user: AuthenticatedUser) {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: user?.roles ?? [] };
  }

  private idempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    return key;
  }
}
```

**주의**: 라우트 순서 — `@Get('by-waybill')` 은 `:shipmentId` 를 쓰는 다른 컨트롤러 라우트와 충돌하지 않게 이 컨트롤러 안에서 먼저 선언한다. 기존 `ShipmentController` 에도 `@Controller('shipments')` 가 있으므로 두 컨트롤러가 같은 prefix 를 공유한다 — Nest 는 등록 순서를 따르니 `fulfillment.module.ts` 의 `controllers` 배열에서 `SimpleOutboundController` 를 `ShipmentController` **앞에** 넣는다.

`fulfillment.module.ts` 수정:
- import 3개 추가 (`SimpleOutboundService`, `ShipmentWaybillReader`, `SimpleOutboundController`)
- `providers` 에 `SimpleOutboundService`, `ShipmentWaybillReader` 추가
- `controllers` 배열 맨 앞에 `SimpleOutboundController` 추가
- `__support__/simple-outbound-wiring.ts` 의 조립과 provider 목록이 일치하는지 확인

- [ ] **Step 4: 테스트 + 빌드 확인**

Run: `npx jest apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.spec.ts`
Expected: PASS (4 passed)

Run: `npx nest build core`
Expected: 컴파일 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/dto/simple-outbound.dto.ts apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.ts apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.spec.ts apps/core/src/modules/fulfillment/fulfillment.module.ts
git commit -m "feat(core): 단순출고 엔드포인트 3종 배선 (조회·스캔·강제완료)"
```

---

## Part 2 — warehouse-app

모든 앱 태스크의 실행 디렉터리는 `native/warehouse-app` 다.

### Task 9: 도메인 타입 + 조회 훅

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/types.ts`
- Create: `native/warehouse-app/src/domains/outbound/queries.ts`
- Test: `native/warehouse-app/src/domains/outbound/queries.test.tsx`

**Interfaces:**
- Consumes: Task 8 의 HTTP 계약
- Produces:
  - `ShipmentByWaybill`, `SimpleOutboundState`, `SimpleOutboundLineProgress`, `OutboundBatchSummary` 타입
  - `useShipmentByWaybill(): UseMutationResult` 형태가 아니라 **명령형 조회**가 필요하다 — 스캔 시점에 1회 호출하고 결과로 화면을 이동하므로 `useMutation` 을 쓴다: `useShipmentByWaybill()` → `mutateAsync(trackingNo: string): Promise<ShipmentByWaybill>`
  - `useOutboundBatches(warehouseId: string | null, status: 'created' | 'picking')` → `UseQueryResult<OutboundBatchSummary[]>`

- [ ] **Step 1: 실패하는 테스트 작성**

`queries.test.tsx` — 기존 `domains/inbound/queries.test.tsx` 의 래퍼 패턴을 따른다.

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import { useOutboundBatches, useShipmentByWaybill } from './queries';

function wrap(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

describe('useShipmentByWaybill', () => {
  it('운송장번호를 쿼리스트링으로 넘긴다', async () => {
    const paths: string[] = [];
    const client: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return { shipmentId: 's-1', trackingNo: 'T-1', carrier: 'HANJIN', lines: [] };
      }) as unknown as ApiClient['request'],
    };
    const { result } = renderHook(() => useShipmentByWaybill(), { wrapper: wrap(client) });

    const found = await result.current.mutateAsync('T-1');

    expect(found.shipmentId).toBe('s-1');
    expect(paths).toEqual(['/shipments/by-waybill?trackingNo=T-1']);
  });
});

describe('useOutboundBatches', () => {
  it('창고가 없으면 호출하지 않는다', async () => {
    const paths: string[] = [];
    const client: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return [];
      }) as unknown as ApiClient['request'],
    };
    const { result } = renderHook(() => useOutboundBatches(null, 'picking'), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(paths).toEqual([]);
  });

  it('창고·상태를 쿼리스트링으로 넘긴다', async () => {
    const paths: string[] = [];
    const client: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return [{ id: 'b-1', batchNumber: 'OB-1', name: '오전', status: 'picking', totalItems: 3, totalQty: 7 }];
      }) as unknown as ApiClient['request'],
    };
    const { result } = renderHook(() => useOutboundBatches('w-1', 'picking'), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(paths).toEqual(['/outbound-batches/v2?warehouseId=w-1&status=picking']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/queries.test.tsx`
Expected: FAIL — `Failed to resolve import "./queries"`

- [ ] **Step 3: 구현**

`types.ts`:

```ts
export interface SimpleOutboundLineProgress {
  shipmentLineId: string;
  skuId: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export interface SimpleOutboundState {
  shipmentId: string;
  workItemStatus: string;
  status: 'in_progress' | 'shipped';
  dispatchAttemptId: string | null;
  lines: SimpleOutboundLineProgress[];
}

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  inspectedQty: number;
}

export interface ShipmentByWaybill {
  shipmentId: string;
  trackingNo: string;
  carrier: string;
  waybillStatus: string;
  shipmentStatus: string;
  batchId: string | null;
  workItemId: string | null;
  workItemStatus: string | null;
  recipientMasked: string;
  lines: ShipmentByWaybillLine[];
}

export interface OutboundBatchSummary {
  id: string;
  batchNumber: string;
  name: string;
  status: string;
  totalItems: number;
  totalQty: number;
}

export interface SimpleOutboundScanInput {
  shipmentId: string;
  barcode: string;
  quantity: number;
  idempotencyKey: string;
}

export interface ForceSimpleOutboundInput {
  shipmentId: string;
  reason: string;
  idempotencyKey: string;
}
```

`queries.ts`:

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { OutboundBatchSummary, ShipmentByWaybill } from './types';

/**
 * GET /shipments/by-waybill?trackingNo=…
 *
 * 스캔 시점에 딱 한 번 부르고 결과로 화면을 이동한다 — 캐시로 붙잡을 이유가
 * 없어서 useQuery 가 아니라 useMutation 이다.
 */
export function useShipmentByWaybill() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (trackingNo: string) => {
      const qs = new URLSearchParams({ trackingNo });
      return api.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?${qs.toString()}` });
    },
  });
}

/**
 * GET /outbound-batches/v2?warehouseId=&status=
 *
 * status 는 서버가 단일 값만 받는다(`listBatches` 가 파생 상태로 후필터). 여러
 * 상태를 보려면 상태별로 훅을 여러 번 쓴다.
 */
export function useOutboundBatches(warehouseId: string | null, status: 'created' | 'picking') {
  const api = useApiClient();
  return useQuery({
    queryKey: ['outbound-batches', warehouseId, status],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '', status });
      return api.request<OutboundBatchSummary[]>({ path: `/outbound-batches/v2?${qs.toString()}` });
    },
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/queries.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/
git commit -m "feat(warehouse-app): 출고작업 도메인 타입과 조회 훅 추가"
```

---

### Task 10: 뮤테이션 훅 + 에러 문맥

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/mutations.ts`
- Test: `native/warehouse-app/src/domains/outbound/mutations.test.tsx`
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts`
- Test: `native/warehouse-app/src/core/data/errorMessage.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: Task 9 타입
- Produces:
  - `useSimpleOutboundScan()` → `mutateAsync(input: SimpleOutboundScanInput): Promise<SimpleOutboundState>`
  - `useForceSimpleOutbound()` → `mutateAsync(input: ForceSimpleOutboundInput): Promise<SimpleOutboundState>`
  - `errorMessage(error, 'outbound')` 이 403 을 강제출고 문맥으로 매핑

- [ ] **Step 1: 실패하는 테스트 작성**

`mutations.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import { useForceSimpleOutbound, useSimpleOutboundScan } from './mutations';

interface Call {
  path: string;
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}

function wrap(calls: Call[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      return { shipmentId: 's-1', workItemStatus: 'picking', status: 'in_progress', dispatchAttemptId: null, lines: [] };
    }) as unknown as ApiClient['request'],
  };
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

describe('useSimpleOutboundScan', () => {
  it('shipmentId 를 경로로, 나머지를 바디로 보낸다', async () => {
    const calls: Call[] = [];
    const { result } = renderHook(() => useSimpleOutboundScan(), { wrapper: wrap(calls) });

    await result.current.mutateAsync({ shipmentId: 's-1', barcode: '8801', quantity: 2, idempotencyKey: 'k-1' });

    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/shipments/s-1/simple-outbound-scans',
        body: { barcode: '8801', quantity: 2 },
        idempotencyKey: 'k-1',
      },
    ]);
  });
});

describe('useForceSimpleOutbound', () => {
  it('reason 만 바디로 보낸다', async () => {
    const calls: Call[] = [];
    const { result } = renderHook(() => useForceSimpleOutbound(), { wrapper: wrap(calls) });

    await result.current.mutateAsync({ shipmentId: 's-1', reason: '스캔 생략', idempotencyKey: 'k-2' });

    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/shipments/s-1/simple-outbound-forces',
        body: { reason: '스캔 생략' },
        idempotencyKey: 'k-2',
      },
    ]);
  });
});
```

`errorMessage.test.ts` 에 추가:

```ts
  it('출고 문맥의 403 은 강제출고 권한 안내를 준다', () => {
    expect(errorMessage(new Error('POST /x → 403'), 'outbound')).toBe(
      '강제출고 권한이 없어요. 관리자에게 요청해 주세요.'
    );
  });

  it('출고 문맥의 404 는 운송장 안내를 준다', () => {
    expect(errorMessage(new Error('GET /x → 404'), 'outbound')).toBe(
      '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.'
    );
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/mutations.test.tsx src/core/data/errorMessage.test.ts`
Expected: FAIL — `Failed to resolve import "./mutations"` + errorMessage 케이스 2건 실패

- [ ] **Step 3: 구현**

`mutations.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ForceSimpleOutboundInput, SimpleOutboundScanInput, SimpleOutboundState } from './types';

/**
 * POST /shipments/:id/simple-outbound-scans
 *
 * 스캔 한 번이 서버 한 트랜잭션(피킹 → 전량이면 완료·검수·출고)이다. 앱은
 * 응답의 라인 진행을 그대로 그리면 되고 중간 상태를 스스로 계산하지 않는다.
 */
export function useSimpleOutboundScan() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, barcode, quantity, idempotencyKey }: SimpleOutboundScanInput) =>
      api.request<SimpleOutboundState>({
        method: 'POST',
        path: `/shipments/${shipmentId}/simple-outbound-scans`,
        body: { barcode, quantity },
        idempotencyKey,
      }),
    // 출고는 배치 잔량과 재고를 동시에 움직인다 — 한쪽만 갱신하면 두 화면이
    // 서로 다른 사실을 말한다.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['outbound-batches'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}

/** POST /shipments/:id/simple-outbound-forces — 미스캔 수량을 채우고 강제 출고. */
export function useForceSimpleOutbound() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, reason, idempotencyKey }: ForceSimpleOutboundInput) =>
      api.request<SimpleOutboundState>({
        method: 'POST',
        path: `/shipments/${shipmentId}/simple-outbound-forces`,
        body: { reason },
        idempotencyKey,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['outbound-batches'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
```

`errorMessage.ts` 수정 — `ErrorContext` 유니온에 `'outbound'` 를 추가하고, `CONTEXTUAL` 에 항목을 넣고, **문맥 조회를 401/403 일반 분기보다 앞으로** 옮긴다:

```ts
export type ErrorContext =
  | 'barcode'
  | 'location'
  | 'stocktaking'
  | 'movement'
  | 'inbound'
  | 'inbound-cancel'
  | 'putaway'
  | 'outbound';
```

```ts
  outbound: {
    403: '강제출고 권한이 없어요. 관리자에게 요청해 주세요.',
    404: '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.',
  },
```

**409 는 넣지 않는다** — `httpClient` 가 409 를 `ConflictError` 로 먼저 던지므로(`httpClient.ts` 의 `request`) 문맥 표의 409 항목은 화면에서 도달할 수 없는 죽은 분기다. 낙관락 충돌 문구는 기존 `ConflictError` 분기가 담당한다.

```ts
export function errorMessage(error: unknown, context?: ErrorContext): string {
  if (error instanceof ConflictError) {
    return '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.';
  }
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    const status = match ? Number(match[1]) : undefined;
    // 문맥 문구가 일반 문구보다 먼저다 — 403 을 "다시 로그인" 으로 뭉개면
    // 강제출고 권한 부족이 로그인 문제로 오인된다.
    if (status !== undefined && context) {
      const specific = CONTEXTUAL[context][status];
      if (specific) return specific;
    }
    if (status === 401 || status === 403) return '권한이 없어요. 다시 로그인해 주세요.';
    if (status !== undefined && status >= 500) {
      return '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    }
    if (status === 404) return '찾을 수 없어요.';
    if (status === 400) return '요청이 올바르지 않아요.';
  }
  return '알 수 없는 오류가 발생했어요.';
}
```

**409 를 문맥 표에 넣지 않는 이유**는 위 코드 블록 주석에 있다 — `ConflictError` 분기가 먼저 잡으므로 죽은 분기가 된다.

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound src/core/data/errorMessage.test.ts`
Expected: PASS

Run: `cd native/warehouse-app && npx vitest run`
Expected: PASS — 기존 테스트 전량 그린 (errorMessage 순서 변경이 다른 화면 문구를 깨지 않았는지 확인)

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/ native/warehouse-app/src/core/data/errorMessage.ts native/warehouse-app/src/core/data/errorMessage.test.ts
git commit -m "feat(warehouse-app): 단순출고 뮤테이션 훅과 출고 에러 문맥 추가"
```

---

### Task 11: `OutboundQueueScreen` + 라우트·허브 통합

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx`
- Test: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.test.tsx`
- Create: `native/warehouse-app/src/app/routes/OutboundRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx`
- Modify: `native/warehouse-app/src/profiles/handheld/HandheldHome.tsx`, `native/warehouse-app/src/profiles/station/StationHome.tsx`
- Test: `native/warehouse-app/src/app/router.test.tsx` (케이스 추가)

**Interfaces:**
- Consumes: Task 9 `useShipmentByWaybill`, `useOutboundBatches`
- Produces: `OutboundQueueScreen` 컴포넌트, `/outbound` 라우트, `/picking`·`/packing` → `/outbound` 리다이렉트

- [ ] **Step 1: 실패하는 테스트 작성**

`OutboundQueueScreen.test.tsx` — `QuickInboundScreen.test.tsx` 의 래퍼를 그대로 따르고, 스캔 버스로 운송장 바코드를 흘린다.

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { OutboundQueueScreen } from './OutboundQueueScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      스캔:{code}
    </button>
  );
}

function renderScreen(paths: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      paths.push(o.path);
      if (o.path.startsWith('/shipments/by-waybill?trackingNo=T-1')) {
        return {
          shipmentId: 's-1',
          trackingNo: 'T-1',
          carrier: 'HANJIN',
          waybillStatus: 'registered',
          shipmentStatus: 'planned',
          batchId: 'b-1',
          workItemId: 'wi-1',
          workItemStatus: 'queued',
          recipientMasked: '홍길**',
          lines: [],
        };
      }
      if (o.path.startsWith('/shipments/by-waybill')) throw new Error(`GET ${o.path} → 404`);
      if (o.path.startsWith('/outbound-batches/v2')) {
        return [{ id: 'b-1', batchNumber: 'OB-1', name: '오전', status: 'picking', totalItems: 3, totalQty: 7 }];
      }
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="T-1" />
        <ScanButton code="T-404" />
        <OutboundQueueScreen />
      </>
    ),
  });
  const targetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/outbound/simple/$shipmentId',
    component: () => <div>단순출고화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, targetRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>{children}</ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

describe('OutboundQueueScreen', () => {
  it('송장을 스캔하면 단순출고 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('출고작업');

    await user.click(screen.getByRole('button', { name: '스캔:T-1' }));

    expect(await screen.findByText('단순출고화면')).toBeInTheDocument();
  });

  it('없는 운송장은 안내를 띄우고 이동하지 않는다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('출고작업');

    await user.click(screen.getByRole('button', { name: '스캔:T-404' }));

    expect(await screen.findByText('이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
  });

  it('오늘 배치 요약을 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('OB-1')).toBeInTheDocument();
    expect(await screen.findByText('3박스 · 7개')).toBeInTheDocument();
  });
});
```

`router.test.tsx` 에 추가:

```tsx
  it('/picking 과 /packing 은 /outbound 로 보낸다', async () => {
    // 기존 router.test.tsx 의 렌더 헬퍼를 그대로 쓴다. 초기 경로만 바꿔
    // 최종 매치가 /outbound 인지 확인한다.
    const router = renderAppRouter(['/picking']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
  });
```

`renderAppRouter` 가 없으면 기존 파일의 라우터 생성 코드를 함수로 뽑아 재사용한다(테스트 내부 리팩터링).

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/OutboundQueueScreen.test.tsx src/app/router.test.tsx`
Expected: FAIL — `Failed to resolve import "./OutboundQueueScreen"` + 리다이렉트 케이스 실패

- [ ] **Step 3: 구현**

`OutboundQueueScreen.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { Button } from '../../core/design/Button';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useOutboundBatches, useShipmentByWaybill } from './queries';

export function OutboundQueueScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const lookup = useShipmentByWaybill();
  const batches = useOutboundBatches(warehouseId, 'picking');

  const open = (trackingNo: string) => {
    const code = trackingNo.trim();
    if (!code) return;
    setNotice(null);
    lookup.mutate(code, {
      onSuccess: (found) => {
        setManual('');
        void navigate({ to: '/outbound/simple/$shipmentId', params: { shipmentId: found.shipmentId } });
      },
      onError: (error) => setNotice(errorMessage(error, 'outbound')),
    });
  };

  useScanner((event) => open(event.code));

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="출고작업" />
        <WarehousePicker />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title="출고작업" />
      <p className="text-sm text-neutral-500">송장을 스캔하면 그 박스 작업이 열립니다.</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          open(manual);
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2 text-lg"
          inputMode="text"
          placeholder="운송장번호"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label="운송장번호"
        />
        <Button type="submit" disabled={lookup.isPending}>
          조회
        </Button>
      </form>
      {notice !== null && <p role="alert">{notice}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">진행 중인 배치</h2>
        {batches.data?.length === 0 && <p className="text-sm text-neutral-400">진행 중인 배치가 없어요.</p>}
        <ul className="space-y-1">
          {batches.data?.map((batch) => (
            <li key={batch.id} className="rounded border px-3 py-2">
              <p className="font-medium">{batch.batchNumber}</p>
              <p className="text-sm text-neutral-500">
                {batch.totalItems}박스 · {batch.totalQty}개
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

배치 목록은 **비링크**다 — 배치 기반 작업 화면은 플랜 B 다. 지금 링크를 걸면 죽은 링크가 된다.

`app/routes/OutboundRoute.tsx`:

```tsx
import { OutboundQueueScreen } from '../../domains/outbound/OutboundQueueScreen';

export function OutboundRoute() {
  return <OutboundQueueScreen />;
}
```

`routeTree.tsx` 수정:
- `PlaceholderScreen` 을 쓰던 `pickingRoute`·`packingRoute` 를 리다이렉트로 바꾼다:

```tsx
const pickingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/picking',
  beforeLoad: () => {
    throw redirect({ to: '/outbound' });
  },
});
const packingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/packing',
  beforeLoad: () => {
    throw redirect({ to: '/outbound' });
  },
});
const outboundRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/outbound',
  component: OutboundRoute,
});
```

`redirect` 를 `@tanstack/react-router` import 에 추가하고, `outboundRoute` 를 `authedRoute.addChildren([...])` 배열에 넣는다.

허브 타일 교체:
- `HandheldHome.tsx`: `<Link to="/picking"><HubTile icon={ListChecks} label="피킹" /></Link>` → `<Link to="/outbound"><HubTile icon={ListChecks} label="출고작업" /></Link>`
- `StationHome.tsx`: `<Link to="/packing"><HubTile icon={PackageCheck} label="패킹" /></Link>` → `<Link to="/outbound"><HubTile icon={PackageCheck} label="출고작업" /></Link>`

- [ ] **Step 4: 테스트 통과 + 빌드**

Run: `cd native/warehouse-app && npx vitest run`
Expected: PASS — 신규 4건 포함 전량 그린 (허브 타일 라벨을 검사하는 기존 테스트가 있으면 라벨을 함께 갱신한다)

Run: `cd native/warehouse-app && npm run build`
Expected: 타입 에러 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/ native/warehouse-app/src/app/ native/warehouse-app/src/profiles/
git commit -m "feat(warehouse-app): 출고작업 대기열 화면과 허브 타일 통합

피킹·패킹 타일을 출고작업 하나로 합치고 기존 두 라우트는 /outbound 로
리다이렉트한다. 배치 목록은 요약 표시만 한다 — 배치 기반 작업 화면은 플랜 B."
```

---

### Task 12: `SimpleOutboundScreen` — 스캔·진행·완료·예외

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.tsx`
- Test: `native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.test.tsx`
- Create: `native/warehouse-app/src/app/routes/SimpleOutboundRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx`

**Interfaces:**
- Consumes: Task 9 `useShipmentByWaybill`(초기 라인 로드용은 아님 — 아래 참조), Task 10 `useSimpleOutboundScan`·`useForceSimpleOutbound`
- Produces: `SimpleOutboundScreen({ shipmentId }: { shipmentId: string })`, `/outbound/simple/$shipmentId` 라우트

**초기 라인 로드**: 화면이 새로고침·딥링크로 직접 열릴 수 있으므로 `shipmentId` 만으로 라인을 얻어야 한다. Task 7 리더는 `trackingNo` 기준이다. **`useOutboundQueue` 같은 추가 API 를 만들지 않고**, 큐 화면이 조회 결과를 라우터 state 로 넘기고, state 가 없으면(딥링크) "송장을 다시 스캔해 주세요" 안내를 띄운다. 현장 흐름은 항상 스캔으로 들어오므로 이게 충분하고, core 조회를 늘리지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SimpleOutboundScreen } from './SimpleOutboundScreen';
import type { ShipmentByWaybill } from './types';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const shipment: ShipmentByWaybill = {
  shipmentId: 's-1',
  trackingNo: 'T-1',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'queued',
  recipientMasked: '홍길**',
  lines: [
    { shipmentLineId: 'ln-1', skuId: 'sk-1', skuCode: 'CT-001', skuName: '코튼셔츠', qty: 2, inspectedQty: 0 },
  ],
};

function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      스캔:{code}
    </button>
  );
}

function renderScreen(responses: Array<{ status: 'in_progress' | 'shipped'; pickedQty: number; inspectedQty: number }>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let call = 0;
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      if (o.path === '/shipments/s-1/simple-outbound-scans') {
        const next = responses[Math.min(call, responses.length - 1)];
        call += 1;
        return {
          shipmentId: 's-1',
          workItemStatus: next.status === 'shipped' ? 'completed' : 'picking',
          status: next.status,
          dispatchAttemptId: next.status === 'shipped' ? 'att-1' : null,
          lines: [
            { shipmentLineId: 'ln-1', skuId: 'sk-1', qty: 2, pickedQty: next.pickedQty, inspectedQty: next.inspectedQty },
          ],
        };
      }
      throw new Error(`POST ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="8801" />
        <SimpleOutboundScreen shipmentId="s-1" shipment={shipment} />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

describe('SimpleOutboundScreen', () => {
  it('라인 진행을 0/2 로 시작한다', async () => {
    renderScreen([{ status: 'in_progress', pickedQty: 1, inspectedQty: 0 }]);
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(await screen.findByText('0 / 2')).toBeInTheDocument();
  });

  it('스캔하면 서버 응답의 진행으로 갱신한다', async () => {
    const user = userEvent.setup();
    renderScreen([{ status: 'in_progress', pickedQty: 1, inspectedQty: 0 }]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('전량 스캔되면 출고완료와 다음 송장 버튼을 띄운다', async () => {
    const user = userEvent.setup();
    renderScreen([
      { status: 'in_progress', pickedQty: 1, inspectedQty: 0 },
      { status: 'shipped', pickedQty: 2, inspectedQty: 2 },
    ]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('1 / 2');
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByText('출고완료')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '다음 송장 스캔' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/SimpleOutboundScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./SimpleOutboundScreen"`

- [ ] **Step 3: 구현**

```tsx
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useForceSimpleOutbound, useSimpleOutboundScan } from './mutations';
import type { ShipmentByWaybill, SimpleOutboundLineProgress } from './types';

function initialProgress(shipment: ShipmentByWaybill): SimpleOutboundLineProgress[] {
  return shipment.lines.map((line) => ({
    shipmentLineId: line.shipmentLineId,
    skuId: line.skuId,
    qty: line.qty,
    pickedQty: line.inspectedQty,
    inspectedQty: line.inspectedQty,
  }));
}

export function SimpleOutboundScreen({
  shipmentId,
  shipment,
}: {
  shipmentId: string;
  shipment: ShipmentByWaybill | null;
}) {
  const [progress, setProgress] = useState<SimpleOutboundLineProgress[]>(() =>
    shipment ? initialProgress(shipment) : []
  );
  const [shipped, setShipped] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const scan = useSimpleOutboundScan();
  const force = useForceSimpleOutbound();

  // idempotency-key 는 스캔 1회당 하나다. 재시도(httpClient 의 409 1회 재시도)가
  // 이중 계상되지 않게 같은 키를 그대로 쓴다.
  const submit = (barcode: string, quantity: number) => {
    if (shipped) return;
    setNotice(null);
    scan.mutate(
      { shipmentId, barcode, quantity, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: (state) => {
          setProgress(state.lines);
          if (state.status === 'shipped') setShipped(true);
        },
        onError: (error) => setNotice(errorMessage(error, 'outbound')),
      }
    );
  };

  useScanner((event) => submit(event.code, 1));

  if (!shipment) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="단순출고" />
        <p role="alert">송장 정보를 잃었어요. 송장을 다시 스캔해 주세요.</p>
        <Link to="/outbound">
          <Button>출고작업으로</Button>
        </Link>
      </div>
    );
  }

  const skuLabel = (skuId: string) =>
    shipment.lines.find((line) => line.skuId === skuId)?.skuName ?? skuId;

  return (
    <div className="space-y-4">
      <ScreenHeader title="단순출고" />
      <section className="rounded border px-3 py-2">
        <p className="font-medium">
          {shipment.carrier} {shipment.trackingNo}
        </p>
        <p className="text-sm text-neutral-500">{shipment.recipientMasked}</p>
      </section>

      <ul className="space-y-1">
        {progress.map((line) => (
          <li key={line.shipmentLineId} className="flex items-center justify-between rounded border px-3 py-2">
            <span>{skuLabel(line.skuId)}</span>
            <span className="text-lg font-semibold">
              {line.pickedQty} / {line.qty}
            </span>
          </li>
        ))}
      </ul>

      {notice !== null && <p role="alert">{notice}</p>}

      {shipped ? (
        <section className="space-y-2">
          <p className="text-xl font-semibold">출고완료</p>
          <Link to="/outbound">
            <Button>다음 송장 스캔</Button>
          </Link>
        </section>
      ) : (
        <section className="space-y-2">
          <p className="text-sm text-neutral-500">상품 바코드를 스캔하세요.</p>
          <Button variant="secondary" onClick={() => setForceOpen(true)} disabled={force.isPending}>
            강제출고
          </Button>
        </section>
      )}

      <ConfirmDialog
        open={forceOpen}
        title="남은 수량을 스캔 없이 처리할까요?"
        description="실물을 확인했을 때만 사용하세요. 사유가 감사 기록에 남습니다."
        onCancel={() => setForceOpen(false)}
        onConfirm={() => {
          setForceOpen(false);
          force.mutate(
            { shipmentId, reason: '현장 확인 후 스캔 생략', idempotencyKey: crypto.randomUUID() },
            {
              onSuccess: (state) => {
                setProgress(state.lines);
                if (state.status === 'shipped') setShipped(true);
              },
              onError: (error) => setNotice(errorMessage(error, 'outbound')),
            }
          );
        }}
      />
    </div>
  );
}
```

`ConfirmDialog` 의 실제 props 는 `core/design/ConfirmDialog.tsx` 를 읽어 맞춘다(`open`/`title`/`onConfirm` 이름이 다르면 그쪽을 따른다 — 컴포넌트를 수정하지 않는다).

`app/routes/SimpleOutboundRoute.tsx`:

```tsx
import { useParams, useRouterState } from '@tanstack/react-router';
import { SimpleOutboundScreen } from '../../domains/outbound/SimpleOutboundScreen';
import type { ShipmentByWaybill } from '../../domains/outbound/types';

export function SimpleOutboundRoute() {
  const { shipmentId } = useParams({ from: '/_authed/outbound/simple/$shipmentId' });
  // 큐 화면이 조회 결과를 넘긴다. 딥링크·새로고침이면 없으므로 화면이 재스캔을 안내한다.
  const state = useRouterState({ select: (s) => s.location.state as { shipment?: ShipmentByWaybill } });
  return <SimpleOutboundScreen shipmentId={shipmentId} shipment={state?.shipment ?? null} />;
}
```

`routeTree.tsx` 에 라우트를 추가한다:

```tsx
const outboundSimpleRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/outbound/simple/$shipmentId',
  component: SimpleOutboundRoute,
});
```

`OutboundQueueScreen` 의 `navigate` 호출에 조회 결과를 실어 보낸다:

```tsx
        void navigate({
          to: '/outbound/simple/$shipmentId',
          params: { shipmentId: found.shipmentId },
          state: { shipment: found },
        });
```

`useParams({ from })` 의 `from` 문자열은 실제 라우트 id 와 정확히 같아야 한다 — `authedRoute` 의 id 가 `_authed` 이므로 위와 같다. 타입 에러가 나면 라우터가 알려주는 id 를 그대로 쓴다.

- [ ] **Step 4: 테스트 통과 + 빌드**

Run: `cd native/warehouse-app && npx vitest run`
Expected: PASS — 전량 그린

Run: `cd native/warehouse-app && npm run build`
Expected: 타입 에러 0

Run: `cd native/warehouse-app && npx oxlint src/domains/outbound src/app src/core/data/errorMessage.ts`
Expected: 신규 error 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/ native/warehouse-app/src/app/
git commit -m "feat(warehouse-app): 단순출고 박스 작업 화면 — 스캔·진행·출고완료·강제출고"
```

---

### Task 13: 진행 중 작업 복구 카드

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.tsx`
- Create: `native/warehouse-app/src/domains/outbound/lastBox.ts`
- Test: `native/warehouse-app/src/domains/outbound/lastBox.test.ts`
- Test: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.test.tsx` (케이스 추가)

**Interfaces:**
- Consumes: `DevicePrefs`(`core/data/devicePrefs`), Task 9 `ShipmentByWaybill`
- Produces: `readLastBox(prefs: DevicePrefs): ShipmentByWaybill | null`, `writeLastBox(prefs: DevicePrefs, shipment: ShipmentByWaybill): void`, `clearLastBox(prefs: DevicePrefs): void`

교차 배치 work item 조회 API 가 없으므로(스펙 §6.1) 마지막 작업 컨텍스트를 기기에 남겨 복귀시킨다. 앱이 죽거나 작업자가 허브로 나갔다 돌아왔을 때 송장을 다시 찾지 않아도 되게 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lastBox.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { clearLastBox, readLastBox, writeLastBox } from './lastBox';
import type { ShipmentByWaybill } from './types';

const shipment: ShipmentByWaybill = {
  shipmentId: 's-1',
  trackingNo: 'T-1',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'queued',
  recipientMasked: '홍길**',
  lines: [],
};

describe('lastBox', () => {
  it('쓰고 읽는다', () => {
    const prefs = createMemoryPrefs();
    writeLastBox(prefs, shipment);
    expect(readLastBox(prefs)).toEqual(shipment);
  });

  it('지우면 null 이다', () => {
    const prefs = createMemoryPrefs();
    writeLastBox(prefs, shipment);
    clearLastBox(prefs);
    expect(readLastBox(prefs)).toBeNull();
  });

  it('깨진 값은 null 로 흘린다 — 복구 카드가 앱을 못 띄우게 하면 안 된다', () => {
    const prefs = createMemoryPrefs({ 'almondwms.outbound.lastBox': '{not json' });
    expect(readLastBox(prefs)).toBeNull();
  });
});
```

`OutboundQueueScreen.test.tsx` 에 추가 — `renderScreen` 이 prefs 를 인자로 받게 고치고(기본값은 기존 창고 seed) 케이스를 넣는다:

```tsx
  it('직전 작업이 있으면 복구 카드를 띄운다', async () => {
    renderScreen([], createMemoryPrefs({
      'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
      'almondwms.outbound.lastBox': JSON.stringify({
        shipmentId: 's-1',
        trackingNo: 'T-1',
        carrier: 'HANJIN',
        waybillStatus: 'registered',
        shipmentStatus: 'planned',
        batchId: 'b-1',
        workItemId: 'wi-1',
        workItemStatus: 'picking',
        recipientMasked: '홍길**',
        lines: [],
      }),
    }));

    expect(await screen.findByText('하던 작업 이어서')).toBeInTheDocument();
    expect(await screen.findByText('HANJIN T-1')).toBeInTheDocument();
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/lastBox.test.ts src/domains/outbound/OutboundQueueScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./lastBox"` + 복구 카드 케이스 실패

- [ ] **Step 3: 구현**

`lastBox.ts`:

```ts
import type { DevicePrefs } from '../../core/data/devicePrefs';
import type { ShipmentByWaybill } from './types';

const KEY = 'almondwms.outbound.lastBox';

/** 마지막으로 열었던 박스. 교차 배치 work item 조회 API 가 없어 기기에 남긴다. */
export function readLastBox(prefs: DevicePrefs): ShipmentByWaybill | null {
  const raw = prefs.get(KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as ShipmentByWaybill;
    return typeof parsed?.shipmentId === 'string' ? parsed : null;
  } catch {
    // 깨진 값 하나가 화면을 못 띄우게 하면 안 된다 — 없는 것으로 취급한다.
    return null;
  }
}

export function writeLastBox(prefs: DevicePrefs, shipment: ShipmentByWaybill): void {
  prefs.set(KEY, JSON.stringify(shipment));
}

export function clearLastBox(prefs: DevicePrefs): void {
  prefs.remove(KEY);
}
```

`OutboundQueueScreen.tsx`: `useWarehouse` 와 같은 방식으로 prefs 에 접근한다. `WarehouseProvider` 가 prefs 를 컨텍스트로 노출하지 않으면 화면이 `localStoragePrefs` 를 직접 import 하고, 테스트는 그 모듈을 `vi.mock` 하는 대신 **prop 으로 주입**받게 한다:

```tsx
export function OutboundQueueScreen({ prefs = localStoragePrefs }: { prefs?: DevicePrefs }) {
```

그리고 조회 성공 시 `writeLastBox(prefs, found)` 를 부르고, 목록 위에 복구 카드를 렌더한다:

```tsx
      {resume !== null && (
        <section className="space-y-1 rounded border border-blue-300 px-3 py-2">
          <p className="text-sm font-medium">하던 작업 이어서</p>
          <p>
            {resume.carrier} {resume.trackingNo}
          </p>
          <Link to="/outbound/simple/$shipmentId" params={{ shipmentId: resume.shipmentId }} state={{ shipment: resume }}>
            <Button>이어서 작업</Button>
          </Link>
        </section>
      )}
```

`const [resume] = useState(() => readLastBox(prefs));` — 렌더마다 다시 읽지 않는다(작업 중 값이 바뀌어도 화면이 흔들리지 않게).

`SimpleOutboundScreen.tsx`: 출고완료 시 `clearLastBox(prefs)` 를 부른다. 이 화면도 `prefs` 를 옵셔널 prop 으로 받는다(기본값 `localStoragePrefs`). 완료된 박스가 복구 카드로 남으면 작업자가 끝난 박스를 다시 연다.

`OutboundRoute.tsx`·`SimpleOutboundRoute.tsx` 는 prop 을 넘기지 않는다 — 기본값이 실기기 저장소다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/warehouse-app && npx vitest run`
Expected: PASS — 전량 그린

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/
git commit -m "feat(warehouse-app): 진행 중 출고작업 복구 카드 (기기 로컬 컨텍스트)"
```

---

### Task 14: 수량 입력 (묶음·다수 스캔)

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.tsx`
- Test: `native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.test.tsx` (케이스 추가)

**Interfaces:**
- Consumes: `NumberPad`(`core/design/NumberPad` — props `{ value: number; onChange: (next: number) => void; allowNegative?: boolean }`), Task 10 `useSimpleOutboundScan`
- Produces: 화면에 수량 지정 스캔 경로 추가 (기본은 1개)

같은 상품이 여러 개인 박스에서 한 개씩 N번 스캔하는 건 현장 부담이다. 스캔 전에 수량을 정해두면 그 수량으로 한 번에 올라간다.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
  it('수량을 지정하고 스캔하면 그 수량으로 올린다', async () => {
    const user = userEvent.setup();
    const bodies: Array<{ barcode: string; quantity: number }> = [];
    renderScreen([{ status: 'shipped', pickedQty: 2, inspectedQty: 2 }], bodies);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '수량 지정' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(bodies).toEqual([{ barcode: '8801', quantity: 2 }]);
  });

  it('스캔 후 수량은 1로 돌아간다 — 다음 상품에 옛 수량이 새면 안 된다', async () => {
    const user = userEvent.setup();
    const bodies: Array<{ barcode: string; quantity: number }> = [];
    renderScreen(
      [
        { status: 'in_progress', pickedQty: 2, inspectedQty: 0 },
        { status: 'in_progress', pickedQty: 3, inspectedQty: 0 },
      ],
      bodies,
    );
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '수량 지정' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('2 / 2');
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(bodies).toEqual([
      { barcode: '8801', quantity: 2 },
      { barcode: '8801', quantity: 1 },
    ]);
  });
```

`renderScreen` 이 두 번째 인자로 요청 바디를 수집하게 고친다(`request` 안에서 `bodies.push(o.body)`).

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/SimpleOutboundScreen.test.tsx -t 수량`
Expected: FAIL — `Unable to find role="button" and name "수량 지정"`

- [ ] **Step 3: 구현**

`SimpleOutboundScreen.tsx` 에 수량 상태와 패드를 추가한다:

```tsx
  const [quantity, setQuantity] = useState(1);
  const [padOpen, setPadOpen] = useState(false);
```

`submit` 에서 수량을 소비하고 되돌린다:

```tsx
  useScanner((event) => {
    const q = quantity;
    setQuantity(1);
    setPadOpen(false);
    submit(event.code, q < 1 ? 1 : q);
  });
```

스캔 안내 아래에 넣는다:

```tsx
          {padOpen ? (
            <NumberPad value={quantity} onChange={setQuantity} />
          ) : (
            <Button variant="secondary" onClick={() => setPadOpen(true)}>
              수량 지정
            </Button>
          )}
          {padOpen && <p className="text-sm">다음 스캔 수량: {quantity < 1 ? 1 : quantity}</p>}
```

`NumberPad` 는 자릿수 누적식이라 `0` 에서 `2` 를 누르면 `2` 가 된다. 초기값 1 에서 `2` 를 누르면 `12` 가 되므로, 패드를 열 때 `setQuantity(0)` 으로 초기화하고 표시·전송 시 `< 1 ? 1 : q` 로 하한을 준다.

- [ ] **Step 4: 테스트 통과 + 빌드**

Run: `cd native/warehouse-app && npx vitest run`
Expected: PASS — 전량 그린

Run: `cd native/warehouse-app && npm run build`
Expected: 타입 에러 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/
git commit -m "feat(warehouse-app): 단순출고 수량 지정 스캔 (기본 1개, 스캔 후 초기화)"
```

---

## 마무리 검증 (전 태스크 완료 후)

- [ ] core 회귀: `DATABASE_URL=… npx jest --runInBand apps/core/src/modules/fulfillment` → 전량 그린
- [ ] core 빌드: `npx nest build core` → 에러 0
- [ ] 앱 테스트: `cd native/warehouse-app && npx vitest run` → 전량 그린
- [ ] 앱 빌드: `cd native/warehouse-app && npm run build` → 에러 0
- [ ] 스펙 §11 실측 항목 확인 결과를 스펙 문서에 반영 (특히 현장 계정의 `DISPATCH_FORCE` 스코프 유무, dev 창고의 `supported_picking_strategies` 에 `discrete` 포함 여부)
- [ ] 기기 스모크: Android 핸드헬드에서 송장 스캔 → 상품 스캔 → 출고완료 1회 (실기기 필요, 사용자 수행)
- [ ] 배포 순서 확인: **core 선배포 → 앱 배포**. 마이그레이션 0건

## 플랜에 없는 것 (스펙 §8 비목표 재확인)

배치 기반 정식 피킹 화면(`/outbound/$batchId`, `deriveQueueRows`, claim/리스 UI), 토탈피킹, `pick_to_tote`, Phase 4 스테이션 패킹·ZPL 인쇄, 앱 내 배치 생성·운송장 발급, 오프라인 큐잉. `/outbound/$batchId/pack/$itemId` 스텁 라우트도 플랜 B 로 미룬다 — 지금 만들면 아무 데서도 링크되지 않는다.

### 재고 부족 신고(short-pick)를 뺀 이유 — 스펙 §6.2 에서 이관

플랜 작성 중 계약을 실측한 결과 **앱에서 직접 호출할 수 없다.** `ReportShipmentShortPickDto`(`dto/shipment-short-pick.dto.ts:41-71`)가 `workItemId`, `expectedWorkItemLeaseVersion`, `planId`, `expectedPlanVersion`, `sessionId`, `expectedSessionVersion`, `expectedManifestVersion`, `lines[]` 를 요구한다. 단순출고는 이 내부 버전값들을 **의도적으로 클라이언트에게 숨기는** 설계(§4.2)이므로 앱이 채울 수 없다.

지원하려면 core 에 버전을 내부에서 해결하는 래퍼(`POST /shipments/:id/simple-outbound-shortages { shipmentLineId, missingQty, reason }`)가 필요하다 — 승인된 core 변경 3건을 넘는 4번째다. 그래서 플랜 A 에서 빼고 스펙도 함께 고쳤다.

**그 사이 현장 대응**: 물건이 실제로 없으면 그 박스를 두고 다음 송장으로 넘어가고 관리자가 admin-web 에서 처리한다. **강제출고로 대체하지 않는다** — 강제출고는 "실물은 있고 스캔만 생략"이라 없는 재고를 출고 처리하면 원장이 거짓이 된다. 이 구분을 화면 문구에도 반영했다(Task 12 의 `ConfirmDialog` 설명).
