// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다(일별 통계 시나리오가 SalesOrdersService 를 만든다).
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { PrintOrderStatus } from '../../print-order/schema/print-order.schema';
import * as f from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import type { StoreFulfillmentStatus } from '../dto/store-order-actions.dto';
import { SalesOrdersService } from '../services/sales-orders.service';
import { recallParcel, seedDispatchedParcel } from './__support__/shipment-facts.fixtures';
import { type OrderShipmentPhase, orderFulfillmentPhaseSql } from './order-fulfillment-phase.sql';
import { readOrderFulfillmentPhases } from './order-fulfillment-phase.reader';

/**
 * 진행 단계 사다리 한 벌(`orderFulfillmentPhaseSql`)을 실 Postgres 로 고정한다 (K6 PR2b).
 * 옛 관리자 단계 spec(`order-shipment-phase.integration.spec.ts`)과 옛 고객 유닛(`store-sales-orders.service.spec.ts`
 * 의 `buildActionsView fulfillmentStatus (V2)`)의 시나리오를 옮겨 왔다 — 두 화면이 같은 사다리를 읽으므로 기대값은
 * (관리자, 고객, any_shipped) 세 칸을 함께 단언한다.
 *
 * 출고·배송은 실제 쓰기 경로 모양의 픽스처(`seedDispatchedParcel`·`recallParcel`)로만 만든다 — 상자 status 만 바꾼
 * 데이터는 수량이 없어 사다리가 움직임으로 보지 않는다(P5). 상자는 `planned`·`draft` 로 만들고 발송이 status 를 바꾼다.
 *
 * 실행: `DATABASE_URL=postgresql://… npx jest --runInBand --runTestsByPath <이 파일>`
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Phase = [admin: OrderShipmentPhase, store: StoreFulfillmentStatus, anyShipped: boolean];
type PhaseRow = {
  sales_order_id: string;
  admin_phase: OrderShipmentPhase;
  store_phase: StoreFulfillmentStatus;
  any_shipped: boolean;
};
type Order = { salesOrderId: string; lineId: string };

describeIfDb('orderFulfillmentPhaseSql — 진행 단계 사다리 한 벌 (K6 PR2b)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  async function phaseOf(tx: DbTx, o: Order): Promise<Phase> {
    const phases = await readOrderFulfillmentPhases(tx, [o.salesOrderId]);
    expect(phases.size).toBe(1);
    const phase = phases.get(o.salesOrderId);
    if (!phase) throw new Error(`phase missing for ${o.salesOrderId}`);
    return [phase.adminPhase, phase.storePhase, phase.anyShipped];
  }

  /** 셀메이트 스크립트(`mark-core-shipped.js`)가 쓰는 모양 — SO shipped, FO shipped·shipped_at, FOI shipped_qty=qty */
  async function markCellmateShipped(tx: DbTx, o: Order, foId?: string): Promise<void> {
    await tx
      .update(wmsTables.salesOrders)
      .set({ status: 'shipped' })
      .where(eq(wmsTables.salesOrders.id, o.salesOrderId));
    if (!foId) return;
    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({ status: 'shipped', shippedAt: new Date() })
      .where(eq(wmsTables.fulfillmentOrders.id, foId));
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ shippedQty: sql`${wmsTables.fulfillmentOrderItems.qty}`, status: 'shipped' })
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId));
  }

  /** 직배 파트너 완료(`fulfillments.service.ts` 의 완료 처리) — direct_ship_status completed 와 FOI shipped_qty=qty 가 같이 간다 */
  async function seedCompletedDropShip(tx: DbTx, w: f.World, o: Order): Promise<void> {
    const { foItemId } = await f.seedFo(tx, w, o, { dropShip: 'completed' });
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ shippedQty: sql`${wmsTables.fulfillmentOrderItems.qty}`, status: 'shipped' })
      .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));
  }

  /** 인쇄 외주 라인 하나 + 그 인쇄 행. 인쇄 라인은 FOI 가 없다 */
  async function seedPrint(tx: DbTx, o: Order, status: PrintOrderStatus): Promise<void> {
    const [line] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: o.salesOrderId,
        variantId: randomUUID(),
        productName: 'PRINT',
        quantity: 1,
        unitPrice: 1000,
      })
      .returning();
    await tx.insert(wmsTables.printOrders).values({
      salesOrderId: o.salesOrderId,
      salesOrderLineId: line.id,
      almondDesignId: randomUUID(),
      status,
    });
  }

  async function dispatch(
    tx: DbTx,
    w: f.World,
    box: { shipmentId: string; lineIds: string[] },
    foItemId: string,
    qty: number,
    delivered: boolean,
  ): Promise<{ dispatchAttemptId: string }> {
    return seedDispatchedParcel(tx, w, {
      shipmentId: box.shipmentId,
      lines: [{ shipmentLineId: box.lineIds[0], foItemId, qty }],
      delivered,
    });
  }

  /** 주문 수량 2, 소포 둘(각 1) — 나눠 보낸 주문 모양 */
  async function seedTwoBoxOrder(tx: DbTx, w: f.World, status: 'draft' | 'planned' | 'recovery_required' = 'draft') {
    const o = await f.seedOrder(tx, { quantity: 2 });
    const fo = await f.seedFo(tx, w, o, { status: 'processing', qty: 2 });
    const first = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', qty: [1] });
    // 복구 상자는 사유 코드가 있어야 한다(상자 체크 제약)
    const second = await f.seedBox(tx, w, [fo.foItemId], {
      status,
      qty: [1],
      recoveryCode: status === 'recovery_required' ? 'CONSOLIDATION_PENDING' : undefined,
    });
    return { o, fo, first, second };
  }

  // ── 옛 관리자 spec 이식 ──

  it('cellmate shipped order without boxes', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx, { status: 'pending' });
      const fo = await f.seedFo(tx, w, o);
      await markCellmateShipped(tx, o, fo.foId);
      expect(await phaseOf(tx, o)).toEqual(['external_shipped', 'shipping', true]);
    });
  });

  it('cellmate shipped order with a core box', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx, { status: 'pending' });
      const fo = await f.seedFo(tx, w, o);
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      await markCellmateShipped(tx, o, fo.foId);
      // SO 외부 출고가 core 상자보다 먼저 이긴다 — 같은 주문을 두 번 세지 않으려는 순서다
      expect(await phaseOf(tx, o)).toEqual(['external_shipped', 'shipping', true]);
    });
  });

  it('cancelled order with a remaining box', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'processing' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      expect(await phaseOf(tx, o)).toEqual(['cancelled', 'canceled', false]);
    });
  });

  it('pending order', async () => {
    await inRollbackTx(db, async (tx) => {
      const o = await f.seedOrder(tx, { status: 'pending' });
      expect(await phaseOf(tx, o)).toEqual(['pending', 'not_created', false]);
    });
  });

  it('one of two parcels dispatched', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const { o, fo, first } = await seedTwoBoxOrder(tx, w);
      await dispatch(tx, w, first, fo.foItemId, 1, false);
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]);
    });
  });

  it('both parcels delivered', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const { o, fo, first, second } = await seedTwoBoxOrder(tx, w, 'planned');
      await dispatch(tx, w, first, fo.foItemId, 1, true);
      await dispatch(tx, w, second, fo.foItemId, 1, true);
      expect(await phaseOf(tx, o)).toEqual(['delivered', 'delivered', true]);
    });
  });

  it('confirmed order with fo and no parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      await f.seedFo(tx, w, o, { status: 'processing' });
      expect(await phaseOf(tx, o)).toEqual(['preparing', 'preparing', false]);
    });
  });

  it('canceled box is ignored', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'processing' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'canceled' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      expect(await phaseOf(tx, o)).toEqual(['preparing', 'preparing', false]);
    });
  });

  it('forwarded drop-ship moves but is not shipped', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const { foItemId } = await f.seedFo(tx, w, o, { status: 'processing', dropShip: 'forwarded' });
      // 화면은 «배송 중»이고 셀프취소는 막히지만(any_shipped) 출고 수량은 0 이다 — 관리자 V1 취소는 지금처럼 된다
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]);
      const [item] = await tx
        .select({ shippedQty: wmsTables.fulfillmentOrderItems.shippedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));
      expect(item.shippedQty).toBe(0);
    });
  });

  it('completed drop-ship shows delivered', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      await seedCompletedDropShip(tx, w, o);
      expect(await phaseOf(tx, o)).toEqual(['delivered', 'delivered', true]);
    });
  });

  it('one row per order in scope', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      // 상자 둘·인쇄 행 둘을 가진 주문도, FO·인쇄가 없는 주문도 주문당 한 행이어야 한다
      const moving = await seedTwoBoxOrder(tx, w);
      await dispatch(tx, w, moving.first, moving.fo.foItemId, 1, false);
      await seedPrint(tx, moving.o, 'submitted');
      await seedPrint(tx, moving.o, 'shipped');
      const withoutFo = await f.seedOrder(tx);
      const printOnly = await f.seedOrder(tx);
      await seedPrint(tx, printOnly, 'delivered');
      const ids = [moving.o.salesOrderId, withoutFo.salesOrderId, printOnly.salesOrderId];

      const rows = await tx.execute<PhaseRow>(
        orderFulfillmentPhaseSql(
          sql`select x.id from unnest(ARRAY[${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]::uuid[]) as x(id)`,
        ),
      );
      expect(rows).toHaveLength(3);
      expect(
        Object.fromEntries(rows.map((r) => [r.sales_order_id, [r.admin_phase, r.store_phase, r.any_shipped]])),
      ).toEqual({
        [moving.o.salesOrderId]: ['shipping', 'shipping', true],
        [withoutFo.salesOrderId]: ['preparing', 'not_created', false],
        [printOnly.salesOrderId]: ['delivered', 'delivered', true],
      });

      // 없는 주문 id 는 행을 내지 않는다 — 행은 판매주문에서 시작한다
      expect((await readOrderFulfillmentPhases(tx, [randomUUID()])).size).toBe(0);
      expect((await readOrderFulfillmentPhases(tx, [])).size).toBe(0);
    });
  });

  it('daily stats count cellmate shipped orders as externalShipped and not as preparing', async () => {
    // 오래된 날짜를 골라 기존 행이 거의 없게 하되, 남은 행이 있어도 되도록 넣기 전/후 차이를 본다
    const day = new Date(Date.UTC(2020, 5, 15, 3, 0, 0)); // KST 2020-06-15 정오
    const bucket = '2020-06-15';
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrdersService(
        { db: tx } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const pointOf = async () => (await service.getDailyStatusStats(bucket, bucket)).series[0];
      const before = await pointOf();

      const w = await f.seedWorld(tx);
      await f.seedOrder(tx, { status: 'pending', createdAt: day }); // pending
      await f.seedOrder(tx, { status: 'confirmed', createdAt: day }); // preparing (FO 전)
      {
        // shipping — 소포 둘 중 하나 발송
        const o = await f.seedOrder(tx, { quantity: 2, createdAt: day });
        const fo = await f.seedFo(tx, w, o, { status: 'processing', qty: 2 });
        const first = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', qty: [1] });
        await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', qty: [1] });
        await dispatch(tx, w, first, fo.foItemId, 1, false);
      }
      {
        // delivered — 소포 하나 배송완료
        const o = await f.seedOrder(tx, { createdAt: day });
        const fo = await f.seedFo(tx, w, o, { status: 'processing' });
        const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
        await dispatch(tx, w, box, fo.foItemId, 1, true);
      }
      {
        // externalShipped — FO 없는 셀메이트 출고
        const o = await f.seedOrder(tx, { status: 'pending', createdAt: day });
        await markCellmateShipped(tx, o);
      }
      {
        // externalShipped — core 상자가 있어도
        const o = await f.seedOrder(tx, { status: 'delivered', createdAt: day });
        const fo = await f.seedFo(tx, w, o);
        await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      }
      {
        // cancelled — 남은 상자가 있어도
        const o = await f.seedOrder(tx, { status: 'cancelled', createdAt: day });
        const fo = await f.seedFo(tx, w, o, { status: 'processing' });
        await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      }

      const after = await pointOf();
      const delta = (
        k: 'pending' | 'preparing' | 'shipping' | 'delivered' | 'externalShipped' | 'cancelled' | 'total',
      ) => after[k] - before[k];
      expect(delta('pending')).toBe(1);
      expect(delta('preparing')).toBe(1);
      expect(delta('shipping')).toBe(1);
      expect(delta('delivered')).toBe(1);
      expect(delta('externalShipped')).toBe(2);
      expect(delta('cancelled')).toBe(1);
      expect(delta('total')).toBe(7);
    });
  });

  // ── 옛 고객 유닛 이식 (store-sales-orders.service.spec.ts 의 buildActionsView fulfillmentStatus) ──

  it('print only all delivered', async () => {
    await inRollbackTx(db, async (tx) => {
      const o = await f.seedOrder(tx);
      await seedPrint(tx, o, 'delivered');
      // P1 — 옛 관리자 뱃지는 인쇄를 안 봐서 preparing 이었다
      expect(await phaseOf(tx, o)).toEqual(['delivered', 'delivered', true]);
    });
  });

  it('print only one shipped one submitted', async () => {
    await inRollbackTx(db, async (tx) => {
      const o = await f.seedOrder(tx);
      await seedPrint(tx, o, 'shipped');
      await seedPrint(tx, o, 'submitted');
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]); // P1
    });
  });

  it('fo ready and print shipped', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      await f.seedFo(tx, w, o, { status: 'ready' });
      await seedPrint(tx, o, 'shipped');
      // 인쇄 shipped 는 출고 사실이자 이행 단위다 — 창고가 준비중이어도 shipping (P1)
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]);
    });
  });

  it('warehouse delivered and print submitted', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'processing' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
      await dispatch(tx, w, box, fo.foItemId, 1, true);
      await seedPrint(tx, o, 'submitted');
      // 있는 몫이 전부 끝나야 delivered — 인쇄가 안 끝났으면 shipping (P1, 옛 관리자 delivered)
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]);
    });
  });

  it('confirmed order without fo', async () => {
    await inRollbackTx(db, async (tx) => {
      const o = await f.seedOrder(tx);
      expect(await phaseOf(tx, o)).toEqual(['preparing', 'not_created', false]);
    });
  });

  it('partially shipped with a draft box', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const { o, fo, first } = await seedTwoBoxOrder(tx, w, 'draft');
      await dispatch(tx, w, first, fo.foItemId, 1, false);
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]);
    });
  });

  it('delivered parcel and a recovery box', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const { o, fo, first } = await seedTwoBoxOrder(tx, w, 'recovery_required');
      await dispatch(tx, w, first, fo.foItemId, 1, true);
      // 남은 몫이 복구 중이어도 배송완료로 가리지 않는다
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]);
    });
  });

  it('recovery box without dispatch', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx, { quantity: 2 });
      const fo = await f.seedFo(tx, w, o, { status: 'processing', qty: 2 });
      await f.seedBox(tx, w, [fo.foItemId], {
        status: 'recovery_required',
        qty: [1],
        recoveryCode: 'CONSOLIDATION_PENDING',
      });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', qty: [1] });
      expect(await phaseOf(tx, o)).toEqual(['preparing', 'preparing', false]);
    });
  });

  // ── 새 시나리오 ──

  it('fo canceled on a confirmed order', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o);
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.foId));
      // P2 — 옛 관리자 뱃지는 preparing 이었다
      expect(await phaseOf(tx, o)).toEqual(['cancelled', 'canceled', false]);
    });
  });

  it('cancelled order before fo', async () => {
    await inRollbackTx(db, async (tx) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      // P3 — 옛 고객 단계는 FO 로 판정해 not_created 였다
      expect(await phaseOf(tx, o)).toEqual(['cancelled', 'canceled', false]);
    });
  });

  it('recalled parcel is not moved', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'processing' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
      const { dispatchAttemptId } = await dispatch(tx, w, box, fo.foItemId, 1, true);
      await recallParcel(tx, { dispatchAttemptId, lines: [{ foItemId: fo.foItemId, qty: 1 }] });
      // 회수는 상자 status 를 되돌리지 않고 추적 행도 남긴다 — 사다리는 수량만 본다
      expect(await phaseOf(tx, o)).toEqual(['preparing', 'preparing', false]);
    });
  });

  it('split order with one delivered parcel is shipping', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const { o, fo, first } = await seedTwoBoxOrder(tx, w, 'draft');
      await dispatch(tx, w, first, fo.foItemId, 1, true);
      // 나눠 보낸 주문(#1093) — 소포 A 배송완료, 남은 B 는 draft. delivered 가 아니다
      expect(await phaseOf(tx, o)).toEqual(['shipping', 'shipping', true]);
    });
  });

  it('cellmate shipped order without FO is shipped', async () => {
    await inRollbackTx(db, async (tx) => {
      const o = await f.seedOrder(tx, { status: 'pending' });
      await markCellmateShipped(tx, o);
      // P4 — 출고 수량은 없지만 SO 상태가 출고 사실이다(missingFO). 셀프취소가 막혀야 한다
      expect(await phaseOf(tx, o)).toEqual(['external_shipped', 'shipping', true]);
    });
  });
});
