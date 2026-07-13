# SO→FO→출고 통합 테스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매주문(SO)→상품매칭→풀필먼트주문(FO)→재고할당→출고작업/피킹/검수/개별출고 종단 흐름을, 로컬 compose `core` DB에 대고 rollback-only 통합 테스트로 검증하고 재고 숫자의 정합성(골든값+보존식+이벤트로그 대조)을 못박는다.

**Architecture:** SO/FO/inventory 세 BC가 공유하는 단일 `wmsSchema` 위에서, 서비스를 Nest DI 없이 `new`로 손와이어링해 하나의 rollback `tx`로 구동한다. 공용 지원 모듈(wiring/fixtures/assertions) 하나에 ~18개 서비스 조립과 숫자 프로브·어서션을 격리하고, 그 위에 시나리오 스펙 4개를 얹는다.

**Tech Stack:** NestJS, Drizzle ORM(postgres-js), Jest(`--runInBand`), 로컬 러너 `npm run test:core:integration:local`.

## ⚠️ 이건 특성화 테스트다 (TDD 아님)

검증 대상 서비스는 **이미 존재**한다. 이 계획의 "구현"은 테스트 코드 자체다. 따라서 사이클은:

1. 스펙 파일을 쓴다 → 2. 러너로 돌린다 → 3. **통과해야 정상**(서비스가 이미 동작하므로) → 4. 커밋.

빨간불이 뜨면 두 경우다: (a) 테스트 와이어링 버그 → 고친다, (b) 실제 도메인 불변식 위반 발견 → **멈추고 조사**(superpowers:systematic-debugging). **절대 assert 를 느슨하게 바꿔 초록불을 만들지 말 것** — 숫자 정합성이 이 작업의 전부다.

## Global Constraints

- 전 스펙 **rollback-only**: 각 케이스를 tx로 감싸고 끝에 `Rollback` sentinel throw. `DATABASE_URL` 게이트(`const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip`). `jest.setTimeout(120_000)`.
- **DbService 대역은 `run`을 채운다**: `{ db, run: (fn, tx) => tx ? fn(tx) : db.transaction((t)=>fn(t)) }`. `{ db }`-only 금지.
- **단일 `drizzle(sql, { schema: wmsSchema })` + 단일 `tx`** 로 세 BC 테이블 모두 접근. 모든 서비스 호출에 `tx` 를 끝인자로 전파.
- **`ProductSellableQuantityService` 는 실인스턴스** (`new ProductSellableQuantityService(dbService as never, invOutbox)`). `as never` 캐스트는 load-bearing(클래스가 `DbService<MergedSchema>` 선언). catalog 테이블은 로컬 `core` DB에 이미 마이그레이션됨 → **catalog 행 seed 불필요**(매핑된 SKU라도 variant 행 없으면 recalc가 `NotFoundException` 삼키고 no-op).
- **재고 이벤트는 RECEIVE·SHIP 만 생성**. 종단은 `SHIP`(OUT/CONFIRM 없음). 예약은 이벤트 아님 → `stock_reservations`(`confirmed`/`released`).
- **`command.receive` 는 실제 `toLocationId` 필수**(null 이면 throw). **sku.code 는 대문자**(inspectScan 바코드 매칭이 `parseBarcode` uppercase → `skus.code` 대조).
- **rollback tx 로 못 타는 3곳 우회**: 백로그 드레인 크론·예약 재시도 크론은 내부 메서드(`fulfillments.create`/`wakeBacklogsWaitingForVariant`/`retryOne`)를 tx 넘겨 직접 호출. `InvoiceService.issueInvoice`(tx 거부)는 `invoices` 행 + FO `status='invoiced'` 직접 seed.
- 실행: `npm run test:core:integration:local -- <패턴>` (러너가 compose postgres 기동 + core 마이그레이션 + jest `--runInBand`).
- SoT 스펙 문서: `docs/superpowers/specs/2026-07-14-so-fo-outbound-integration-testing-design.md` (불변식 I1~I6, §D 숫자 월드).

## File Structure

지원 모듈(테스트 아님, `.spec.ts` 아님 → 러너가 수집 안 함):
- `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts` — DB 대역, `wireLogistics`, `inRollbackTx`, `Rollback`.
- `apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts` — 픽스처 빌더.
- `apps/core/src/modules/fulfillment/services/__support__/logistics-assertions.ts` — 숫자 프로브 + 불변식 어서션.
- `apps/core/src/modules/fulfillment/services/__support__/index.ts` — 배럴.

스펙(러너가 수집):
- `apps/core/src/modules/fulfillment/services/logistics-support.integration.spec.ts` — 지원 모듈 자체 검증(Task 1).
- `apps/core/src/modules/sales-order/services/sales-order-to-fulfillment.conversion.integration.spec.ts` — Task 2.
- `apps/core/src/modules/fulfillment/services/fulfillment-stock-allocation.integration.spec.ts` — Task 3.
- `apps/core/src/modules/fulfillment/services/outbound-batch-pick-ship.integration.spec.ts` — Task 4.
- `apps/core/src/modules/fulfillment/services/so-to-ship.golden-path.integration.spec.ts` — Task 5.

문서:
- `docs/local-dev.md` — "물류 통합 테스트" 섹션에 신규 스펙 추가(Task 6).

---

### Task 1: 공용 지원 모듈 (wiring + fixtures + assertions)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts`
- Create: `apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts`
- Create: `apps/core/src/modules/fulfillment/services/__support__/logistics-assertions.ts`
- Create: `apps/core/src/modules/fulfillment/services/__support__/index.ts`
- Test: `apps/core/src/modules/fulfillment/services/logistics-support.integration.spec.ts`

**Interfaces:**
- Produces:
  - `makeDb(url: string): { sql: postgres.Sql; db: PostgresJsDatabase<typeof wmsSchema> }`
  - `makeDbService(db): DbService<typeof wmsSchema>`
  - `wireLogistics(dbService): Wired` — `Wired` 는 아래 서비스들의 record.
  - `inRollbackTx(db, fn: (tx: DbTx)=>Promise<void>): Promise<void>`
  - fixtures: `seedWarehouseWithZone(tx)`, `seedHolder(tx)`, `seedSku(tx, holderId)`, `receiveStock(command, tx, args)`, `seedSalesOrder(tx, args)`, `seedMatching(tx, args)`, `seedInvoiceIssued(tx, args)`
  - probes/asserts: `onHand`, `onHandAt`, `availableFromView`, `confirmedReserved`, `netFromEvents`, `sumReceived`, `sumShipped`, `assertStockConsistent`, `assertFoReservationAgg`, `assertConservation`

- [ ] **Step 1: `logistics-wiring.ts` 작성**

```ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../../inventory/schema/inventory.schema';

import { OutboxService as InventoryOutboxService } from '../../../inventory/shared/outbox/outbox.service';
import { OutboxService as FulfillmentOutboxService } from '../../outbox/outbox.service';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../../inventory/core/repositories/stock-event.store';
import { LocationService } from '../../../inventory/core/services/location.service';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';
import { UnifiedReservationService } from '../../../inventory/shared/services/unified-reservation.service';
import { ReservationLifecycleService } from '../../../inventory/shared/services/reservation-lifecycle.service';
import { FifoLocationStrategy } from '../../../inventory/core/services/location-resolution.strategy';
import { BarcodeService } from '../../../inventory/shared/services/barcode.service';
import { OutboundConsumptionService } from '../outbound-consumption.service';
import { ShipmentService } from '../shipment.service';
import { PoliciesService } from '../policies.service';
import { AvailabilityService } from '../availability.service';
import { FulfillmentsService } from '../fulfillments.service';
import { FulfillmentReservationsFacade } from '../fulfillment-reservations.facade';
import { FulfillmentOrderReservationRetryWorker } from '../fulfillment-order-reservation-retry.worker';
import { OutboundBatchService } from '../outbound-batch.service';
import { PickingProcessService } from '../picking-process.service';
import { ProductSkuMappingService } from '../../../product-matching/services/product-sku-mapping.service';
import { FulfillmentOrderCreationBacklogService } from '../../backlog/fulfillment-order-creation-backlog.service';

export class Rollback extends Error {}

export function makeDb(url: string): { sql: postgres.Sql; db: PostgresJsDatabase<typeof wmsSchema> } {
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema: wmsSchema });
  return { sql, db };
}

export function makeDbService(db: PostgresJsDatabase<typeof wmsSchema>): DbService<typeof wmsSchema> {
  return {
    db,
    run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
  } as unknown as DbService<typeof wmsSchema>;
}

export interface Wired {
  invOutbox: InventoryOutboxService;
  fulfillmentOutbox: FulfillmentOutboxService;
  sellable: ProductSellableQuantityService;
  eventStore: StockEventStore;
  location: LocationService;
  command: InventoryCommandService;
  unified: UnifiedReservationService;
  lifecycle: ReservationLifecycleService;
  consumption: OutboundConsumptionService;
  barcode: BarcodeService;
  shipment: ShipmentService;
  policies: PoliciesService;
  availability: AvailabilityService;
  backlog: FulfillmentOrderCreationBacklogService;
  productSkuMapping: ProductSkuMappingService;
  fulfillments: FulfillmentsService;
  reservationsFacade: FulfillmentReservationsFacade;
  retryWorker: FulfillmentOrderReservationRetryWorker;
  outboundBatch: OutboundBatchService;
  picking: PickingProcessService;
}

export function wireLogistics(dbService: DbService<typeof wmsSchema>): Wired {
  const invOutbox = new InventoryOutboxService(dbService);
  const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
  const eventStore = new StockEventStore(dbService, sellable);
  const location = new LocationService(dbService);
  const command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
  const unified = new UnifiedReservationService(dbService, sellable);
  const lifecycle = new ReservationLifecycleService(dbService, unified);
  const strategy = new FifoLocationStrategy();
  const consumption = new OutboundConsumptionService(dbService, strategy, command, lifecycle, fulfillmentOutbox);
  const barcode = new BarcodeService(dbService);
  const shipment = new ShipmentService(dbService, barcode, consumption);
  const policies = new PoliciesService(dbService);
  const availability = new AvailabilityService(dbService);
  const backlog = new FulfillmentOrderCreationBacklogService(dbService);
  const productSkuMapping = new ProductSkuMappingService(dbService, sellable, backlog);
  const fulfillments = new FulfillmentsService(
    dbService,
    policies,
    availability,
    lifecycle,
    unified,
    productSkuMapping,
    fulfillmentOutbox,
    undefined,
  );
  const reservationsFacade = new FulfillmentReservationsFacade(dbService, unified, sellable, policies);
  const retryWorker = new FulfillmentOrderReservationRetryWorker(dbService, reservationsFacade);
  const outboundBatch = new OutboundBatchService(dbService);
  const picking = new PickingProcessService(dbService, barcode);

  return {
    invOutbox, fulfillmentOutbox, sellable, eventStore, location, command, unified, lifecycle,
    consumption, barcode, shipment, policies, availability, backlog, productSkuMapping,
    fulfillments, reservationsFacade, retryWorker, outboundBatch, picking,
  };
}

export async function inRollbackTx(
  db: PostgresJsDatabase<typeof wmsSchema>,
  fn: (tx: DbTx) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx as unknown as DbTx);
      throw new Rollback('intentional rollback');
    }),
  ).rejects.toThrow(Rollback);
}
```

- [ ] **Step 2: `logistics-fixtures.ts` 작성**

```ts
import { randomUUID } from 'crypto';
import { wmsTables, DbTx } from '../../../inventory/schema/inventory.schema';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';

export async function seedWarehouseWithZone(tx: DbTx): Promise<{ warehouseId: string; locationId: string }> {
  const [wh] = await tx
    .insert(wmsTables.warehouses)
    .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
    .returning();
  const [loc] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: wh.id, code: `IT-Z-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
    .returning();
  return { warehouseId: wh.id, locationId: loc.id };
}

export async function seedHolder(tx: DbTx): Promise<{ holderId: string }> {
  const [holder] = await tx
    .insert(wmsTables.holders)
    .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
    .returning();
  return { holderId: holder.id };
}

// sku.code 는 대문자 — inspectScan 바코드 매칭이 대문자 code 로 대조.
export async function seedSku(tx: DbTx, holderId: string): Promise<{ skuId: string; skuCode: string }> {
  const skuCode = `IT-${randomUUID().toUpperCase()}`;
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({ name: 'it-sku', code: skuCode, holderId })
    .returning();
  return { skuId: sku.id, skuCode };
}

// RECEIVE 이벤트 + ON_HAND ledger 를 남긴다. toLocationId 필수.
export async function receiveStock(
  command: InventoryCommandService,
  tx: DbTx,
  args: { skuId: string; warehouseId: string; locationId: string; quantity: number },
): Promise<void> {
  await command.receive(
    {
      skuId: args.skuId,
      toWarehouseId: args.warehouseId,
      toLocationId: args.locationId,
      quantity: args.quantity,
      reason: 'IT-SEED',
      idempotencyKey: `recv-${randomUUID()}`,
    },
    tx,
  );
}

// SO + 라인. 라인 mappingSnapshotId 는 default null → 라이브 매칭 경로 강제. variantId 는 임의 UUID.
export async function seedSalesOrder(
  tx: DbTx,
  args: { lines: Array<{ variantId: string; quantity: number; productName?: string }> },
): Promise<{ salesOrderId: string; lineIds: string[] }> {
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `IT-CH-${randomUUID().slice(0, 8)}`,
      salesChannel: 'medusa',
      status: 'confirmed',
      shippingAddress: { name: 'IT', address1: 'x' },
      orderDate: new Date(),
    })
    .returning();

  const lineIds: string[] = [];
  for (const l of args.lines) {
    const [line] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: so.id,
        variantId: l.variantId,
        productName: l.productName ?? 'IT Product',
        quantity: l.quantity,
        unitPrice: 1000,
      })
      .returning();
    lineIds.push(line.id);
  }
  return { salesOrderId: so.id, lineIds };
}

// 사전 매칭(matched/variant) + link. 재매칭-깨우기 경로를 태우지 않는 케이스용(1a/2a/골든 SO-1).
export async function seedMatching(
  tx: DbTx,
  args: { variantId: string; skuId: string; quantity?: number; strategy?: 'variant' | 'void' },
): Promise<{ matchingId: string }> {
  const strategy = args.strategy ?? 'variant';
  const [matching] = await tx
    .insert(wmsTables.productMatchings)
    .values({ variantId: args.variantId, status: 'matched', strategy, isResolved: true, preStockSellable: true })
    .returning();
  if (strategy === 'variant') {
    await tx
      .insert(wmsTables.productVariantSkuLinks)
      .values({ productMatchingId: matching.id, skuId: args.skuId, quantity: args.quantity ?? 1 });
  }
  return { matchingId: matching.id };
}

// issueInvoice(tx 거부) 우회 — issued 인보이스 직접 seed. openBoxByScan 의 입구.
export async function seedInvoiceIssued(
  tx: DbTx,
  args: { fulfillmentOrderId: string },
): Promise<{ trackingNo: string }> {
  const trackingNo = `IT-TRK-${randomUUID().slice(0, 8)}`;
  await tx.insert(wmsTables.invoices).values({
    trackingNo,
    carrier: 'CJ',
    issueMethod: 'self',
    issuedForFulfillmentOrderId: args.fulfillmentOrderId,
    status: 'issued',
  });
  return { trackingNo };
}
```

- [ ] **Step 3: `logistics-assertions.ts` 작성** — 숫자 프로브 + 불변식(I1~I6)

```ts
import { and, eq } from 'drizzle-orm';
import { wmsTables, wmsViews, DbTx } from '../../../inventory/schema/inventory.schema';

// 부호 맵: 우리 시나리오가 만드는 이벤트는 RECEIVE(+)·SHIP(-) 뿐. (일반화하려면 DEFECTIVE 계열 추가 필요.)
const EVENT_SIGN: Record<string, number> = {
  RECEIVE: 1,
  ADJUST_UP: 1,
  SHIP: -1,
  ADJUST_DOWN: -1,
  SCRAP: -1,
};

export async function onHand(tx: DbTx, skuId: string, warehouseId: string): Promise<number> {
  const rows = await tx
    .select({ qty: wmsTables.stockLedgers.qty })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    );
  return rows.reduce((s, r) => s + r.qty, 0);
}

export async function onHandAt(tx: DbTx, skuId: string, locationId: string): Promise<number> {
  const [row] = await tx
    .select({ qty: wmsTables.stockLedgers.qty })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.locationId, locationId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    );
  return row?.qty ?? 0;
}

export async function availableFromView(tx: DbTx, skuId: string, warehouseId: string): Promise<number> {
  const [row] = await tx
    .select({ availableQty: wmsViews.stockSummary.availableQty })
    .from(wmsViews.stockSummary)
    .where(and(eq(wmsViews.stockSummary.skuId, skuId), eq(wmsViews.stockSummary.warehouseId, warehouseId)));
  return row?.availableQty ?? 0;
}

export async function confirmedReserved(tx: DbTx, skuId: string, warehouseId: string): Promise<number> {
  const rows = await tx
    .select({ q: wmsTables.stockReservations.quantity })
    .from(wmsTables.stockReservations)
    .where(
      and(
        eq(wmsTables.stockReservations.skuId, skuId),
        eq(wmsTables.stockReservations.warehouseId, warehouseId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  return rows.reduce((s, r) => s + r.q, 0);
}

// I1 기반: sku 의 stock_events 를 부호합. (단일 창고 전제 — 본 스펙 월드가 그러함.)
export async function netFromEvents(tx: DbTx, skuId: string): Promise<number> {
  const rows = await tx
    .select({ t: wmsTables.stockEvents.transitionType, q: wmsTables.stockEvents.quantity })
    .from(wmsTables.stockEvents)
    .where(eq(wmsTables.stockEvents.skuId, skuId));
  return rows.reduce((s, r) => s + (EVENT_SIGN[r.t as string] ?? 0) * r.q, 0);
}

export async function sumReceived(tx: DbTx, skuId: string): Promise<number> {
  const rows = await tx
    .select({ t: wmsTables.stockEvents.transitionType, q: wmsTables.stockEvents.quantity })
    .from(wmsTables.stockEvents)
    .where(eq(wmsTables.stockEvents.skuId, skuId));
  return rows.filter((r) => r.t === 'RECEIVE' || r.t === 'ADJUST_UP').reduce((s, r) => s + r.q, 0);
}

export async function sumShipped(tx: DbTx, skuId: string): Promise<number> {
  const rows = await tx
    .select({ q: wmsTables.stockEvents.quantity })
    .from(wmsTables.stockEvents)
    .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
  return rows.reduce((s, r) => s + r.q, 0);
}

// I1(이벤트↔원장) + I2(가용 항등) + 골든값 을 한 번에.
export async function assertStockConsistent(
  tx: DbTx,
  args: { skuId: string; warehouseId: string; onHand: number; reserved: number },
): Promise<void> {
  const oh = await onHand(tx, args.skuId, args.warehouseId);
  expect(oh).toBe(args.onHand); // 골든값
  expect(await netFromEvents(tx, args.skuId)).toBe(oh); // I1
  expect(await confirmedReserved(tx, args.skuId, args.warehouseId)).toBe(args.reserved);
  expect(await availableFromView(tx, args.skuId, args.warehouseId)).toBe(oh - args.reserved); // I2
}

// I3(예약 3중 합): FO.totalReservedQty == Σ FOI.reservedQty == Σ confirmed 예약(targetId=FO).
export async function assertFoReservationAgg(tx: DbTx, fulfillmentOrderId: string): Promise<void> {
  const [fo] = await tx
    .select({ total: wmsTables.fulfillmentOrders.totalReservedQty })
    .from(wmsTables.fulfillmentOrders)
    .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
  const fois = await tx
    .select({ r: wmsTables.fulfillmentOrderItems.reservedQty })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));
  const foiSum = fois.reduce((s, r) => s + r.r, 0);
  const resRows = await tx
    .select({ q: wmsTables.stockReservations.quantity })
    .from(wmsTables.stockReservations)
    .where(
      and(
        eq(wmsTables.stockReservations.targetId, fulfillmentOrderId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  const resSum = resRows.reduce((s, r) => s + r.q, 0);
  expect(fo.total).toBe(foiSum);
  expect(fo.total).toBe(resSum);
}

// I6(물질보존): 골든 received/shipped 와 이벤트합·원장을 교차 확인. received == onHand + shipped.
export async function assertConservation(
  tx: DbTx,
  args: { skuId: string; warehouseId: string; received: number; shipped: number },
): Promise<void> {
  const oh = await onHand(tx, args.skuId, args.warehouseId);
  expect(await sumReceived(tx, args.skuId)).toBe(args.received);
  expect(await sumShipped(tx, args.skuId)).toBe(args.shipped);
  expect(args.received).toBe(oh + args.shipped);
}
```

- [ ] **Step 4: `index.ts` 배럴 작성**

```ts
export * from './logistics-wiring';
export * from './logistics-fixtures';
export * from './logistics-assertions';
```

- [ ] **Step 5: 지원 모듈 검증 스펙 작성** `logistics-support.integration.spec.ts`

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  makeDb, makeDbService, wireLogistics, inRollbackTx, Wired,
  seedWarehouseWithZone, seedHolder, seedSku, seedMatching, receiveStock,
  onHand, netFromEvents, availableFromView, assertStockConsistent, assertConservation,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('logistics integration support (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  it('전체 서비스 그래프가 조립되고 receive 가 ON_HAND + RECEIVE 이벤트를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);

      await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });

      expect(await onHand(tx, skuId, warehouseId)).toBe(10);
      expect(await netFromEvents(tx, skuId)).toBe(10);
      await assertStockConsistent(tx, { skuId, warehouseId, onHand: 10, reserved: 0 });
      await assertConservation(tx, { skuId, warehouseId, received: 10, shipped: 0 });
    });
  });

  it('매핑된 SKU(variant catalog 행 없음)에도 receive/recalc 가 예외 없이 no-op 로 통과한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      const variantId = randomUUID(); // catalog product_variants 에 없는 임의 variant

      await seedMatching(tx, { variantId, skuId, quantity: 1 });
      await expect(
        receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 7 }),
      ).resolves.toBeUndefined();

      expect(await onHand(tx, skuId, warehouseId)).toBe(7);
    });
  });

  it('assertStockConsistent 는 골든값이 틀리면 실제로 실패한다 (negative check)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });

      // onHand 는 10 인데 9 로 주장 → throw 해야 정상.
      await expect(
        assertStockConsistent(tx, { skuId, warehouseId, onHand: 9, reserved: 0 }),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 6: 러너로 실행 → 통과 확인**

Run: `npm run test:core:integration:local -- logistics-support.integration`
Expected: 3 passed. 만약 첫 케이스가 서비스 생성자 arity/import 오류로 실패하면 와이어링(Step 1)의 인자 순서·import 경로를 소스와 대조해 고친다. 두 번째 케이스가 catalog 관련 SQL 오류로 실패하면(테이블 부재) 로컬 core DB 마이그레이션 상태부터 점검(`npm run db:migrate:local`).

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/__support__ \
        apps/core/src/modules/fulfillment/services/logistics-support.integration.spec.ts
git commit -m "test(logistics): SO×FO×출고 통합 테스트 공용 지원 모듈 + 검증 스펙"
```

---

### Task 2: 스펙 1 — SO→FO 변환·상품매칭

**Files:**
- Create: `apps/core/src/modules/sales-order/services/sales-order-to-fulfillment.conversion.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `__support__` 배럴 전체. import 경로는 `../../fulfillment/services/__support__`.

- [ ] **Step 1: 스펙 파일 작성** (케이스 1a·1b·1c·1d)

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  makeDb, makeDbService, wireLogistics, inRollbackTx, Wired,
  seedWarehouseWithZone, seedHolder, seedSku, seedSalesOrder, seedMatching, receiveStock,
} from '../../fulfillment/services/__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SO→FO 변환·상품매칭 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  // (sku, 창고, 재고 100, 매칭 준비) 공통 배경. matched=false 면 매칭 미생성.
  async function background(tx: DbTx, opts: { matched: boolean; soQty: number; variantId: string }) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: [{ variantId: opts.variantId, quantity: opts.soQty }],
    });
    if (opts.matched) await seedMatching(tx, { variantId: opts.variantId, skuId, quantity: 1 });
    return { warehouseId, skuId, salesOrderId, salesOrderLineId: lineIds[0] };
  }

  it('1a) 매칭된 라인은 FO 로 변환되고 FOI.qty == SO라인.qty × link.quantity', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const bg = await background(tx, { matched: true, soQty: 5, variantId });

      const fo = await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      expect(fo).toBeTruthy();

      const [foRow] = await tx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, bg.salesOrderId));
      expect(foRow).toBeTruthy();

      const fois = await tx
        .select({ skuId: wmsTables.fulfillmentOrderItems.skuId, qty: wmsTables.fulfillmentOrderItems.qty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foRow.id));
      expect(fois).toHaveLength(1);
      expect(fois[0]).toMatchObject({ skuId: bg.skuId, qty: 5 });
    });
  });

  it('1b) 매칭 없는 라인은 PRODUCT_SKU_MATCHING_REQUIRED 로 실패하고 backlog 를 awaiting_matching 으로 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const bg = await background(tx, { matched: false, soQty: 3, variantId });

      // 변환 시도 → throw. 에러 payload 검증.
      let caught: any;
      try {
        await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeTruthy();
      const payload = caught.getResponse ? caught.getResponse() : caught.response;
      expect(payload).toMatchObject({ code: 'PRODUCT_SKU_MATCHING_REQUIRED' });
      expect(payload.missingLines).toEqual([
        expect.objectContaining({ variantId, reason: 'NO_PRODUCT_SKU_MATCHING' }),
      ]);

      // 백로그 enqueue → processing 으로 만든 뒤 markAwaitingMatching.
      await w.backlog.enqueueForSalesOrder(bg.salesOrderId, tx);
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'processing' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, bg.salesOrderId));
      await w.backlog.markAwaitingMatching(
        (await backlogRow(tx, bg.salesOrderId)).id,
        [{ salesOrderLineId: bg.salesOrderLineId, variantId, reason: 'NO_PRODUCT_SKU_MATCHING' }],
        tx,
      );

      const bl = await backlogRow(tx, bg.salesOrderId);
      expect(bl.status).toBe('awaiting_matching');
      expect(bl.waitingVariantIds).toContain(variantId);
    });
  });

  it('1c) 재매칭 upsert 는 backlog 를 pending 으로 깨우고, 재변환 시 FO 가 생성된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const bg = await background(tx, { matched: false, soQty: 4, variantId });
      const { holderId } = await seedHolder(tx);
      const { skuId: skuForMatch } = await seedSku(tx, holderId);

      // 1b 상태 재현: enqueue → processing → awaiting_matching.
      await w.backlog.enqueueForSalesOrder(bg.salesOrderId, tx);
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'processing' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, bg.salesOrderId));
      await w.backlog.markAwaitingMatching(
        (await backlogRow(tx, bg.salesOrderId)).id,
        [{ salesOrderLineId: bg.salesOrderLineId, variantId, reason: 'NO_PRODUCT_SKU_MATCHING' }],
        tx,
      );
      expect((await backlogRow(tx, bg.salesOrderId)).status).toBe('awaiting_matching');

      // 재매칭 → wakeBacklogsWaitingForVariant 가 pending 으로.
      await w.productSkuMapping.upsert(variantId, { links: [{ skuId: skuForMatch, quantity: 1 }] }, tx);
      expect((await backlogRow(tx, bg.salesOrderId)).status).toBe('pending');

      // 재변환 성공.
      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const [foRow] = await tx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, bg.salesOrderId));
      expect(foRow).toBeTruthy();
      const fois = await tx
        .select({ skuId: wmsTables.fulfillmentOrderItems.skuId, qty: wmsTables.fulfillmentOrderItems.qty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foRow.id));
      expect(fois).toEqual([expect.objectContaining({ skuId: skuForMatch, qty: 4 })]);
    });
  });

  it('1d) void 전략 매칭은 라인을 드롭한다 (physical FOI 0건)', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
      const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 2 }] });
      await seedMatching(tx, { variantId, skuId, strategy: 'void' });

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      const [foRow] = await tx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
      const fois = foRow
        ? await tx
            .select({ id: wmsTables.fulfillmentOrderItems.id })
            .from(wmsTables.fulfillmentOrderItems)
            .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foRow.id))
        : [];
      expect(fois).toHaveLength(0); // void → physical item 없음
    });
  });

  async function backlogRow(tx: DbTx, salesOrderId: string) {
    const [row] = await tx
      .select({
        id: wmsTables.fulfillmentOrderCreationBacklogs.id,
        status: wmsTables.fulfillmentOrderCreationBacklogs.status,
        waitingVariantIds: wmsTables.fulfillmentOrderCreationBacklogs.waitingVariantIds,
      })
      .from(wmsTables.fulfillmentOrderCreationBacklogs)
      .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));
    return row;
  }
});
```

- [ ] **Step 2: 러너로 실행 → 통과 확인**

Run: `npm run test:core:integration:local -- conversion.integration`
Expected: 4 passed. 1d 에서 void 라인만 있는 SO 는 FO 자체가 안 생기거나 `status='completed'` 로 생길 수 있다 — 어느 쪽이든 physical FOI 0건이 핵심(위 assert 는 두 경우 모두 통과). 1b 의 에러 payload 접근이 `getResponse()`/`response` 어느 쪽인지 실패 메시지로 확인해 맞춘다.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/sales-order-to-fulfillment.conversion.integration.spec.ts
git commit -m "test(logistics): SO→FO 변환·상품매칭 통합 테스트 (변환/실패/재매칭/void)"
```

---

### Task 3: 스펙 2 — FO 재고 할당·재시도

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/fulfillment-stock-allocation.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `__support__` (경로 `./__support__`). `assertStockConsistent`, `assertFoReservationAgg` 로 I2·I3 검증.

- [ ] **Step 1: 스펙 파일 작성** (케이스 2a·2b·2c)

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  makeDb, makeDbService, wireLogistics, inRollbackTx, Wired,
  seedWarehouseWithZone, seedHolder, seedSku, seedSalesOrder, seedMatching, receiveStock,
  assertStockConsistent, assertFoReservationAgg,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('FO 재고 할당·재시도 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  // 매칭된 SO 하나를 만들고 onHand 를 세팅. FO 는 만들지 않음(케이스에서 create).
  async function background(tx: DbTx, opts: { onHand: number; soQty: number }) {
    const variantId = randomUUID();
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    if (opts.onHand > 0) await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: opts.onHand });
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: opts.soQty }] });
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    return { warehouseId, locationId, skuId, salesOrderId };
  }

  async function foBySo(tx: DbTx, salesOrderId: string) {
    const [row] = await tx
      .select({
        id: wmsTables.fulfillmentOrders.id,
        status: wmsTables.fulfillmentOrders.status,
        totalReservedQty: wmsTables.fulfillmentOrders.totalReservedQty,
        reservationFailureReason: wmsTables.fulfillmentOrders.reservationFailureReason,
        reservationFailureDetails: wmsTables.fulfillmentOrders.reservationFailureDetails,
      })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    return row;
  }

  it('2a) 재고 충분 → FO ready, 예약 정합(I2·I3), onHand 는 예약으로 불변', async () => {
    await inRollbackTx(db, async (tx) => {
      const bg = await background(tx, { onHand: 100, soQty: 40 });

      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const fo = await foBySo(tx, bg.salesOrderId);

      expect(fo.status).toBe('ready');
      await assertStockConsistent(tx, { skuId: bg.skuId, warehouseId: bg.warehouseId, onHand: 100, reserved: 40 });
      await assertFoReservationAgg(tx, fo.id);
    });
  });

  it('2b) 재고 부족 → FO unfulfillable + failureDetails 숫자 정확, 예약 0건', async () => {
    await inRollbackTx(db, async (tx) => {
      const bg = await background(tx, { onHand: 1, soQty: 3 });

      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const fo = await foBySo(tx, bg.salesOrderId);

      expect(fo.status).toBe('unfulfillable');
      expect(fo.reservationFailureReason).toBe('RESERVATION_FAILED');
      const failed = (fo.reservationFailureDetails as any).failedItems[0];
      expect(failed).toMatchObject({ requiredQty: 3, availableQty: 1 });
      // all-or-nothing: 부분예약 없음.
      await assertStockConsistent(tx, { skuId: bg.skuId, warehouseId: bg.warehouseId, onHand: 1, reserved: 0 });
    });
  });

  it('2c) 부족→보충→retryOne → FO ready, 예약 채워짐', async () => {
    await inRollbackTx(db, async (tx) => {
      const bg = await background(tx, { onHand: 1, soQty: 3 });
      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const fo = await foBySo(tx, bg.salesOrderId);
      expect(fo.status).toBe('unfulfillable');

      // 보충 +5 → onHand 6.
      await receiveStock(w.command, tx, { skuId: bg.skuId, warehouseId: bg.warehouseId, locationId: bg.locationId, quantity: 5 });

      // 재시도 워커 내부 메서드 직접 호출(크론 우회).
      const candidates = await w.retryWorker.findCandidates(50, tx);
      expect(candidates.map((c) => c.id)).toContain(fo.id);
      await w.retryWorker.retryOne(fo.id, tx);

      const after = await foBySo(tx, bg.salesOrderId);
      expect(after.status).toBe('ready');
      await assertStockConsistent(tx, { skuId: bg.skuId, warehouseId: bg.warehouseId, onHand: 6, reserved: 3 });
      await assertFoReservationAgg(tx, fo.id);
    });
  });
});
```

- [ ] **Step 2: 러너로 실행 → 통과 확인**

Run: `npm run test:core:integration:local -- fulfillment-stock-allocation.integration`
Expected: 3 passed. 2b 의 `failedItems` 키명(`requiredQty`/`availableQty`)이 실패로 어긋나면 `fulfillments.service.ts` 의 `reservationFailureDetails` 조립부(약 :435)에서 실제 키명을 확인해 맞춘다.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-stock-allocation.integration.spec.ts
git commit -m "test(logistics): FO 재고 할당·재시도 통합 테스트 (ready/unfulfillable/retry)"
```

---

### Task 4: 스펙 3 — 출고작업·피킹·검수·개별출고

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/outbound-batch-pick-ship.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `__support__`. `seedInvoiceIssued`, `availableFromView`, `onHand`, `assertConservation`.
- 배경 FO 는 create 경로로 만든다(2a 와 동일). 그래야 예약 confirmed 가 정확히 붙는다.

- [ ] **Step 1: 스펙 파일 작성** (케이스 3a·3b·3c — 순차 진행되는 단일 시나리오)

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  makeDb, makeDbService, wireLogistics, inRollbackTx, Wired,
  seedWarehouseWithZone, seedHolder, seedSku, seedSalesOrder, seedMatching, seedInvoiceIssued, receiveStock,
  onHand, availableFromView, assertConservation,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('출고작업·피킹·검수·개별출고 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  // ready FO 하나(onHand 100, qty 10, 예약 confirmed)를 create 경로로 만든다.
  async function seedReadyFo(tx: DbTx) {
    const variantId = randomUUID();
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId, skuCode } = await seedSku(tx, holderId);
    await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 10 }] });
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    await w.fulfillments.create({ salesOrderId, warehouseId }, tx);
    const [fo] = await tx
      .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    expect(fo.status).toBe('ready');
    const [foi] = await tx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
    return { warehouseId, skuId, skuCode, foId: fo.id, foiId: foi.id };
  }

  async function foStatus(tx: DbTx, foId: string) {
    const [r] = await tx.select({ s: wmsTables.fulfillmentOrders.status }).from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, foId));
    return r?.s;
  }

  it('3a·3b·3c) 배치→피킹→완료→송장→박스오픈→검수→개별출고 종단, 수량·상태·I5 불변', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedReadyFo(tx);
      const operatorId = randomUUID();

      // 3a) 배치: ready FO 를 개별피킹 배치에 편입 → allocated.
      const { batchId } = await w.outboundBatch.createBatch({ warehouseId: f.warehouseId, pickingMethod: 'individual' }, tx);
      await w.outboundBatch.addFulfillmentOrdersToBatch(batchId, [f.foId], tx);
      expect(await foStatus(tx, f.foId)).toBe('allocated');
      const [batch] = await tx
        .select({ status: wmsTables.outboundBatches.status, totalQty: wmsTables.outboundBatches.totalQty, totalItems: wmsTables.outboundBatches.totalItems })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId));
      expect(batch).toMatchObject({ status: 'created', totalItems: 1, totalQty: 10 });

      // 3b) 피킹.
      await w.outboundBatch.startPicking(batchId, tx);
      expect(await foStatus(tx, f.foId)).toBe('picking');
      await w.picking.pickItem({ batchId, skuId: f.skuId, pickedQty: 10, pickerUserId: operatorId }, tx);
      const [foiPicked] = await tx
        .select({ picked: wmsTables.fulfillmentOrderItems.pickedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.foiId));
      expect(foiPicked.picked).toBe(10);
      await w.outboundBatch.completeBatch(batchId, tx);
      expect(await foStatus(tx, f.foId)).toBe('picked');

      // 3c) 송장(우회 seed) + FO invoiced → 박스오픈 → 검수 → 자동 소진.
      const { trackingNo } = await seedInvoiceIssued(tx, { fulfillmentOrderId: f.foId });
      await tx.update(wmsTables.fulfillmentOrders).set({ status: 'invoiced' }).where(eq(wmsTables.fulfillmentOrders.id, f.foId));

      const availBefore = await availableFromView(tx, f.skuId, f.warehouseId); // 100-10=90
      expect(availBefore).toBe(90);

      const { shipmentId } = await w.shipment.openBoxByScan(trackingNo, operatorId, tx);
      await w.shipment.inspectScan(shipmentId, f.skuCode, 10, operatorId, tx); // 전량 검수 → consume 자동발사

      // 종단 상태.
      expect(await foStatus(tx, f.foId)).toBe('shipped');
      const [ship] = await tx.select({ s: wmsTables.shipments.status }).from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
      expect(ship.s).toBe('shipped');
      const [foiShipped] = await tx
        .select({ shipped: wmsTables.fulfillmentOrderItems.shippedQty, status: wmsTables.fulfillmentOrderItems.status })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.foiId));
      expect(foiShipped).toMatchObject({ shipped: 10, status: 'shipped' });

      // I4: 검수 라인 inspectedQty == qty.
      const [line] = await tx
        .select({ inspected: wmsTables.shipmentLines.inspectedQty, qty: wmsTables.shipmentLines.qty })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
      expect(line.inspected).toBe(line.qty);

      // I5: 출고 후 onHand 10 감소·available 불변.
      expect(await onHand(tx, f.skuId, f.warehouseId)).toBe(90);
      expect(await availableFromView(tx, f.skuId, f.warehouseId)).toBe(availBefore); // 90 → 불변
      // SHIP 1건.
      const ships = await tx
        .select({ q: wmsTables.stockEvents.quantity })
        .from(wmsTables.stockEvents)
        .where(and(eq(wmsTables.stockEvents.skuId, f.skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
      expect(ships).toEqual([{ q: 10 }]);
      // I6: received(100) == onHand(90) + shipped(10).
      await assertConservation(tx, { skuId: f.skuId, warehouseId: f.warehouseId, received: 100, shipped: 10 });
    });
  });
});
```

- [ ] **Step 2: 러너로 실행 → 통과 확인**

Run: `npm run test:core:integration:local -- outbound-batch-pick-ship.integration`
Expected: 1 passed. `addFulfillmentOrdersToBatch` 후 FO 상태가 `allocated` 가 아니면(예: 즉시 `picking`) 실제 전이를 확인해 assert 를 맞춘다. `createBatch` 가 빈 배치를 거부하면 `salesOrderIds` 경로로 바꾼다(설계 §F 참고). `pickItem` 이 `total_picking` 관련으로 실패하면 `pickingMethod: 'individual'` 확인.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/outbound-batch-pick-ship.integration.spec.ts
git commit -m "test(logistics): 출고작업·피킹·검수·개별출고 통합 테스트 (I5 가용 불변 포함)"
```

---

### Task 5: 스펙 4 — 골든패스 E2E

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/so-to-ship.golden-path.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1~4 에서 검증된 모든 헬퍼·서비스. 설계 §D 숫자 타임라인(t0~t7)을 한 tx 로 관통.

- [ ] **Step 1: 스펙 파일 작성** (SO-1 매칭즉시 / SO-2 매칭없음→매칭→부족→보충→재시도, 둘 다 출고)

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  makeDb, makeDbService, wireLogistics, inRollbackTx, Wired,
  seedWarehouseWithZone, seedHolder, seedSku, seedSalesOrder, seedMatching, seedInvoiceIssued, receiveStock,
  onHand, availableFromView, assertStockConsistent, assertFoReservationAgg, assertConservation,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SO→출고 골든패스 E2E (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  async function foBySo(tx: DbTx, soId: string) {
    const [r] = await tx
      .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, soId));
    return r;
  }
  async function backlogRow(tx: DbTx, soId: string) {
    const [r] = await tx
      .select({ id: wmsTables.fulfillmentOrderCreationBacklogs.id, status: wmsTables.fulfillmentOrderCreationBacklogs.status })
      .from(wmsTables.fulfillmentOrderCreationBacklogs)
      .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, soId));
    return r;
  }
  async function shipFoViaBox(tx: DbTx, args: { foId: string; skuId: string; skuCode: string; qty: number; operatorId: string }) {
    const { trackingNo } = await seedInvoiceIssued(tx, { fulfillmentOrderId: args.foId });
    await tx.update(wmsTables.fulfillmentOrders).set({ status: 'invoiced' }).where(eq(wmsTables.fulfillmentOrders.id, args.foId));
    const { shipmentId } = await w.shipment.openBoxByScan(trackingNo, args.operatorId, tx);
    await w.shipment.inspectScan(shipmentId, args.skuCode, args.qty, args.operatorId, tx);
  }

  it('t0~t7: 매칭·재고 분기 후 두 FO 모두 배치·피킹·검수·출고, 모든 숫자 정합', async () => {
    await inRollbackTx(db, async (tx) => {
      const operatorId = randomUUID();
      const V1 = randomUUID();
      const V2 = randomUUID();

      // 월드: 창고 W1, 로케이션 L1, SKU-A / SKU-B.
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const A = await seedSku(tx, holderId);
      const B = await seedSku(tx, holderId);

      // t0: receive A+10, B+1.
      await receiveStock(w.command, tx, { skuId: A.skuId, warehouseId, locationId, quantity: 10 });
      await receiveStock(w.command, tx, { skuId: B.skuId, warehouseId, locationId, quantity: 1 });
      await assertStockConsistent(tx, { skuId: A.skuId, warehouseId, onHand: 10, reserved: 0 });
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 1, reserved: 0 });

      // SO-1(V1→A, 5), SO-2(V2→B, 3).
      const so1 = await seedSalesOrder(tx, { lines: [{ variantId: V1, quantity: 5 }] });
      const so2 = await seedSalesOrder(tx, { lines: [{ variantId: V2, quantity: 3 }] });

      // t1: SO-1 사전매칭 + 변환+할당 → FO-1 ready, reserved A=5.
      await seedMatching(tx, { variantId: V1, skuId: A.skuId, quantity: 1 });
      await w.fulfillments.create({ salesOrderId: so1.salesOrderId, warehouseId }, tx);
      const fo1 = await foBySo(tx, so1.salesOrderId);
      expect(fo1.status).toBe('ready');
      await assertStockConsistent(tx, { skuId: A.skuId, warehouseId, onHand: 10, reserved: 5 });
      await assertFoReservationAgg(tx, fo1.id);

      // t2: SO-2 변환 시도(매칭X) → throw → backlog awaiting_matching.
      await expect(w.fulfillments.create({ salesOrderId: so2.salesOrderId, warehouseId }, tx)).rejects.toThrow();
      await w.backlog.enqueueForSalesOrder(so2.salesOrderId, tx);
      await tx.update(wmsTables.fulfillmentOrderCreationBacklogs).set({ status: 'processing' }).where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, so2.salesOrderId));
      await w.backlog.markAwaitingMatching((await backlogRow(tx, so2.salesOrderId)).id, [{ salesOrderLineId: so2.lineIds[0], variantId: V2, reason: 'NO_PRODUCT_SKU_MATCHING' }], tx);
      expect((await backlogRow(tx, so2.salesOrderId)).status).toBe('awaiting_matching');

      // t3: V2 매칭 → backlog pending, 재변환 → 재고부족(B=1 < 3) → FO-2 unfulfillable.
      await w.productSkuMapping.upsert(V2, { links: [{ skuId: B.skuId, quantity: 1 }] }, tx);
      expect((await backlogRow(tx, so2.salesOrderId)).status).toBe('pending');
      await w.fulfillments.create({ salesOrderId: so2.salesOrderId, warehouseId }, tx);
      const fo2 = await foBySo(tx, so2.salesOrderId);
      expect(fo2.status).toBe('unfulfillable');
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 1, reserved: 0 });

      // t4: receive B+5 → onHand 6.
      await receiveStock(w.command, tx, { skuId: B.skuId, warehouseId, locationId, quantity: 5 });
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 6, reserved: 0 });

      // t5: retryOne → FO-2 ready, reserved B=3.
      await w.retryWorker.retryOne(fo2.id, tx);
      expect((await foBySo(tx, so2.salesOrderId)).status).toBe('ready');
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 6, reserved: 3 });
      await assertFoReservationAgg(tx, fo2.id);

      // t6: 두 FO 를 한 배치로 → 피킹 → 완료.
      const { batchId } = await w.outboundBatch.createBatch({ warehouseId, pickingMethod: 'individual' }, tx);
      await w.outboundBatch.addFulfillmentOrdersToBatch(batchId, [fo1.id, fo2.id], tx);
      await w.outboundBatch.startPicking(batchId, tx);
      await w.picking.pickItem({ batchId, skuId: A.skuId, pickedQty: 5, pickerUserId: operatorId }, tx);
      await w.picking.pickItem({ batchId, skuId: B.skuId, pickedQty: 3, pickerUserId: operatorId }, tx);
      await w.outboundBatch.completeBatch(batchId, tx);

      // t6→t7: 개별출고 A, 그다음 B. 각 박스별 검수→소진. I5(가용 불변) 확인.
      const availA = await availableFromView(tx, A.skuId, warehouseId); // 5
      await shipFoViaBox(tx, { foId: fo1.id, skuId: A.skuId, skuCode: A.skuCode, qty: 5, operatorId });
      expect(await onHand(tx, A.skuId, warehouseId)).toBe(5);
      expect(await availableFromView(tx, A.skuId, warehouseId)).toBe(availA); // 5 불변

      const availB = await availableFromView(tx, B.skuId, warehouseId); // 3
      await shipFoViaBox(tx, { foId: fo2.id, skuId: B.skuId, skuCode: B.skuCode, qty: 3, operatorId });
      expect(await onHand(tx, B.skuId, warehouseId)).toBe(3);
      expect(await availableFromView(tx, B.skuId, warehouseId)).toBe(availB); // 3 불변

      // 끝: 물질보존 sweep (I6). SHIP 이벤트 각 1건.
      await assertConservation(tx, { skuId: A.skuId, warehouseId, received: 10, shipped: 5 });
      await assertConservation(tx, { skuId: B.skuId, warehouseId, received: 6, shipped: 3 });
      expect(await foBySo(tx, so1.salesOrderId).then((r) => r.status)).toBe('shipped');
      expect(await foBySo(tx, so2.salesOrderId).then((r) => r.status)).toBe('shipped');
      for (const skuId of [A.skuId, B.skuId]) {
        const ships = await tx
          .select({ q: wmsTables.stockEvents.quantity })
          .from(wmsTables.stockEvents)
          .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
        expect(ships).toHaveLength(1);
      }
    });
  });
});
```

- [ ] **Step 2: 러너로 실행 → 통과 확인**

Run: `npm run test:core:integration:local -- golden-path.integration`
Expected: 1 passed. 어느 체크포인트든 숫자가 어긋나면 **멈추고 조사** — 그 지점이 실제 불변식 위반 후보다(assert 를 고치지 말 것). 특히 t5 이후 avail B=3, t7 이후 onHand B=3 이 핵심.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/so-to-ship.golden-path.integration.spec.ts
git commit -m "test(logistics): SO→출고 골든패스 E2E 통합 테스트 (숫자 타임라인 t0~t7)"
```

---

### Task 6: 문서 업데이트

**Files:**
- Modify: `docs/local-dev.md` — "물류 통합 테스트" 섹션.

- [ ] **Step 1: `docs/local-dev.md` 의 "물류 통합 테스트" 섹션에 신규 스펙 안내 추가**

"새 통합 테스트 작성 레시피" 항목 아래에 다음 문단을 추가한다:

```markdown
**SO×FO×출고 종단 스펙 (2026-07)**: `sales-order-to-fulfillment.conversion` / `fulfillment-stock-allocation` / `outbound-batch-pick-ship` / `so-to-ship.golden-path` 4개는 세 BC(sales-order·fulfillment·inventory)를 한 tx로 관통하는 종단 스펙이다. 공용 와이어링/픽스처/숫자 어서션은 `apps/core/src/modules/fulfillment/services/__support__/` 에 있다. 재고 숫자 정합성은 골든값 + 보존식 + 이벤트로그 대조(I1~I6, 설계 스펙 참고)로 검증한다. 실행 예: `npm run test:core:integration:local -- golden-path.integration`.
```

- [ ] **Step 2: 전체 물류 통합 스펙 일괄 실행 → 회귀 확인**

Run: `npm run test:core:integration:local -- integration`
Expected: 신규 4개 + 기존 스펙 전부 통과(또는 기존과 무관한 skip). 만약 러너 기본 패턴이 다른 앱 스펙까지 끌어와 실패하면 패턴을 좁혀(`-- 'inventory|fulfillment|sales-order'`) 확인.

- [ ] **Step 3: 커밋**

```bash
git add docs/local-dev.md
git commit -m "docs(test): SO×FO×출고 종단 통합 스펙 로컬 실행 안내 추가"
```

---

## Self-Review

**1. Spec coverage (설계 §A~§F 대조):**
- §A I1~I6 → Task 1 의 `assertStockConsistent`(I1·I2)·`assertFoReservationAgg`(I3)·`assertConservation`(I6), Task 4·5 의 I4(picked/shipped/inspected)·I5(avail 불변). ✅
- §B 공용 지원 모듈 → Task 1. ✅
- §C 스펙 1~4 → Task 2·3·4·5. 케이스 1a~1d/2a~2c/3a~3c/골든 전부 매핑. ✅
- §D 숫자 월드 t0~t7 → Task 5 그대로. ✅
- §E 파일 레이아웃·러너 → File Structure + 각 run step. ✅
- §F tx 우회(크론2·issueInvoice) → Global Constraints + Task 2(markAwaitingMatching 수동)·Task 3(retryOne 직접)·Task 4·5(invoice seed). ✅
- 검증 방법의 negative check → Task 1 Step 5 세 번째 케이스. ✅

**2. Placeholder scan:** "TBD/TODO/적당히" 없음. 모든 스텝에 실제 코드. run step 의 "실패하면 …확인" 문구는 특성화 테스트의 정상 디버그 가이드(플레이스홀더 아님).

**3. Type consistency:** `Wired` record 키(`command`/`fulfillments`/`outboundBatch`/`picking`/`retryWorker`/`backlog`/`productSkuMapping`/`shipment`)를 전 스펙에서 `w.<key>` 로 동일 사용. 헬퍼 시그니처(`assertStockConsistent({skuId,warehouseId,onHand,reserved})`, `receiveStock(command, tx, {…locationId…})`, `seedMatching({variantId,skuId,quantity?,strategy?})`)가 정의부와 호출부 일치. `command.receive` 는 `toLocationId` 필수 — `receiveStock` 가 항상 전달. ✅

**주의(실행 중 확인할 알려진 불확실성):**
- 1b 의 에러 payload 접근(`getResponse()` vs `.response`)은 첫 실행에서 확정.
- 2b 의 `reservationFailureDetails.failedItems[].{requiredQty,availableQty}` 키명은 소스(`fulfillments.service.ts` :435 부근)로 확정.
- 4/5 의 `addFulfillmentOrdersToBatch` 후 FO 상태(`allocated` 가정)와 `createBatch` 빈배치 허용 여부는 첫 실행에서 확정, 필요 시 §F 대안(salesOrderIds 경로)로 전환.
- FulfillmentsService 7번째 인자 outbox 는 fulfillment outbox 전달(런타임 동일 형상이라 무해).
