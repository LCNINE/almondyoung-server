import * as postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressReader, JudgedRow } from './order-progress.reader';
import { isStuck } from './order-progress.thresholds';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('order-progress 판정 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let reader: OrderProgressReader;
  const now = new Date('2026-10-06T03:00:00.000Z');

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    reader = new OrderProgressReader(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  /** 시나리오를 롤백 트랜잭션 안에서 만들고 판정한다. */
  async function judgeIn(build: (tx: DbTx, w: f.World) => Promise<string[]>): Promise<JudgedRow[]> {
    let rows: JudgedRow[] = [];
    await expect(
      db.transaction(async (tx) => {
        const w = await f.seedWorld(tx as unknown as DbTx);
        const ids = await build(tx as unknown as DbTx, w);
        rows = await reader.judge(ids, now, tx as unknown as DbTx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    return rows;
  }
  const one = async (build: (tx: DbTx, w: f.World) => Promise<string>) =>
    (await judgeIn(async (tx, w) => [await build(tx, w)]))[0];

  it('backlog 없음 → accept/no_backlog, 진입 = 판매주문 created_at', async () => {
    const created = new Date('2026-10-06T02:00:00.000Z');
    const r = await one(async (tx) => (await f.seedOrder(tx, { createdAt: created })).salesOrderId);
    expect(r).toMatchObject({
      stage: 'accept',
      state: 'no_backlog',
      outcome: null,
      estimatedEnteredAt: created.toISOString(),
    });
  });

  it('backlog awaiting_matching → fo, 진입 = backlog created_at', async () => {
    const at = new Date('2026-07-16T00:00:00.000Z');
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'fo', state: 'awaiting_matching', estimatedEnteredAt: at.toISOString() });
  });

  it('backlog not_required → 종료 not_required', async () => {
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'not_required');
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'not_required' });
  });

  it('판매주문 shipped(셀메이트) → 종료 external_shipped, 상자가 draft 여도', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'shipped' });
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o);
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'external_shipped' });
  });

  it('draft + FO partially_reserved → reserve, 진입 = FO created_at', async () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'partially_reserved', createdAt: at });
      // 라인 2개 중 1개만 예약됐다 — 부분 예약은 FO 상태가 아니라 상자의 예약으로 정해진다
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', qty: [2] });
      await f.seedConfirmedReservation(tx, w, {
        foId: fo.foId,
        foItemId: fo.foItemId,
        shipmentLineId: box.lineIds[0],
        quantity: 1,
      });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'reserve', state: 'partially_reserved', estimatedEnteredAt: at.toISOString() });
  });

  it('draft + FO ready → plan/awaiting_plan, 진입 = opened_at', async () => {
    const at = new Date('2026-10-05T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', openedAt: at });
      await f.seedFullReservations(tx, w, { foId: fo.foId, foItemIds: [fo.foItemId], box });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'plan', state: 'awaiting_plan', estimatedEnteredAt: at.toISOString() });
  });

  /** 같은 FO 에 품목을 하나 더 단다(판매주문당 FO 는 하나라, 한 FO 의 상자 둘은 품목 둘로 나눈다) */
  async function addFoItem(tx: DbTx, w: f.World, o: { salesOrderId: string; lineId: string }, foId: string) {
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: foId,
        salesOrderId: o.salesOrderId,
        salesOrderLineId: o.lineId,
        skuId: w.skuId,
        qty: 1,
      })
      .returning();
    return item.id;
  }

  /** 시나리오를 만들고 주문 판정과 상자별 판정을 함께 본다 */
  async function judgeOrderAndBoxes(
    build: (tx: DbTx, w: f.World) => Promise<{ orderId: string; boxIds: string[] }>,
  ): Promise<{ order: JudgedRow; boxes: Map<string, Awaited<ReturnType<OrderProgressReader['judgeShipment']>>> }> {
    let order: JudgedRow | undefined;
    const boxes = new Map<string, Awaited<ReturnType<OrderProgressReader['judgeShipment']>>>();
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as DbTx;
        const w = await f.seedWorld(tx);
        const { orderId, boxIds } = await build(tx, w);
        [order] = await reader.judge([orderId], now, tx);
        for (const id of boxIds) boxes.set(id, await reader.judgeShipment(id, tx));
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    return { order: order!, boxes };
  }

  // 판정은 FO 상태가 아니라 «상자 라인 수량 vs 그 라인의 확정 예약 합»으로 한다(#1016 15번)
  it('한 FO 의 두 상자 — 다 예약된 상자는 «계획 대기», 미예약 상자는 «예약», 주문 대표는 «예약»', async () => {
    const { order, boxes } = await judgeOrderAndBoxes(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'partially_reserved' });
      const second = await addFoItem(tx, w, o, fo.foId);
      const boxA = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      const boxB = await f.seedBox(tx, w, [second], { status: 'draft' });
      await f.seedConfirmedReservation(tx, w, {
        foId: fo.foId,
        foItemId: fo.foItemId,
        shipmentLineId: boxA.lineIds[0],
      });
      return { orderId: o.salesOrderId, boxIds: [boxA.shipmentId, boxB.shipmentId] };
    });
    const [boxA, boxB] = [...boxes.keys()];
    expect(order).toMatchObject({ stage: 'reserve', state: 'created' });
    expect(boxes.get(boxA)).toMatchObject({ stage: 'plan', state: 'awaiting_plan' });
    expect(boxes.get(boxB)).toMatchObject({ stage: 'reserve', state: 'created' });
  });

  it('일부 예약 라인(qty 3, 예약 2)은 «부분 예약»', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'partially_reserved' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', qty: [3] });
      await f.seedConfirmedReservation(tx, w, {
        foId: fo.foId,
        foItemId: fo.foItemId,
        shipmentLineId: box.lineIds[0],
        quantity: 2,
      });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'reserve', state: 'partially_reserved' });
  });

  // 상자 합만 비교하면 넘치게 예약된 라인이 모자란 라인을 가린다 — plan 의 assertFullyReserved 는 라인별이다
  it('한 라인이 넘치게 예약돼도 다른 라인이 덜 예약이면 상자는 «예약»(부분 예약)', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'partially_reserved' });
      const second = await addFoItem(tx, w, o, fo.foId);
      const box = await f.seedBox(tx, w, [fo.foItemId, second], { status: 'draft', qty: [1, 1] });
      await f.seedConfirmedReservation(tx, w, {
        foId: fo.foId,
        foItemId: fo.foItemId,
        shipmentLineId: box.lineIds[0],
        quantity: 2,
      });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'reserve', state: 'partially_reserved' });
  });

  it('라인 수량만큼 예약되면(qty 3, 예약 3) «계획 대기»', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'created' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', qty: [3] });
      await f.seedConfirmedReservation(tx, w, {
        foId: fo.foId,
        foItemId: fo.foItemId,
        shipmentLineId: box.lineIds[0],
        quantity: 3,
      });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'plan', state: 'awaiting_plan' });
  });

  it('FO 가 processing 이어도 draft 상자가 덜 예약이면 «예약»', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'processing' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'reserve', state: 'created' });
  });

  it('취소·해제된 예약은 세지 않는다 — 확정(confirmed)만 센다', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      await f.seedConfirmedReservation(tx, w, { foId: fo.foId, foItemId: fo.foItemId, shipmentLineId: box.lineIds[0] });
      await tx
        .update(wmsTables.stockReservations)
        .set({ status: 'released' })
        .where(eq(wmsTables.stockReservations.shipmentLineId, box.lineIds[0]));
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'reserve', state: 'created' });
  });

  it('합포장 상자 — 한 주문 라인만 예약돼도 상자 전체가 덜 예약이면 두 주문 모두 «예약»(D13)', async () => {
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fa.foItemId, fb.foItemId], { status: 'draft' });
      await f.seedConfirmedReservation(tx, w, { foId: fa.foId, foItemId: fa.foItemId, shipmentLineId: box.lineIds[0] });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows.map((r) => [r.stage, r.state])).toEqual([
      ['reserve', 'partially_reserved'],
      ['reserve', 'partially_reserved'],
    ]);
  });

  it('취소 대기(CANCEL_REPLAN_PENDING) 상자와 넘기지 않은 입점사 상자의 판정은 그대로다', async () => {
    const ids: string[] = [];
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'created' });
      await f.seedBox(tx, w, [fa.foItemId], { status: 'draft', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      await f.seedBox(tx, w, [fb.foItemId], { status: 'draft', supplierId: await f.seedDirectSupplier(tx) });
      ids.push(a.salesOrderId, b.salesOrderId);
      return ids;
    });
    const byId = new Map(rows.map((r) => [r.salesOrderId, r]));
    expect(byId.get(ids[0])).toMatchObject({ stage: 'cancel', state: 'CANCEL_REPLAN_PENDING' });
    expect(byId.get(ids[1])).toMatchObject({ stage: 'dispatch', state: 'drop_ship_pending' });
  });

  it('planned + 송장 없음 → waybill/none / registered → pick/awaiting_batch', async () => {
    const plannedAt = new Date('2026-10-05T10:00:00.000Z');
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      await f.seedBox(tx, w, [fa.foItemId], { status: 'planned', plannedAt });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fb.foItemId], { status: 'planned', plannedAt });
      await f.seedWaybill(tx, box.shipmentId, 'registered');
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows.map((r) => [r.stage, r.state])).toEqual(
      expect.arrayContaining([
        ['waybill', 'none'],
        ['pick', 'awaiting_batch'],
      ]),
    );
  });

  it('작업 중 → pick/<작업 상태>, completed 이고 아직 planned → dispatch', async () => {
    const plannedAt = new Date('2026-10-05T10:00:00.000Z');
    const doneAt = new Date('2026-10-05T11:00:00.000Z');
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      const ba = await f.seedBox(tx, w, [fa.foItemId], { status: 'planned', plannedAt });
      await f.seedWorkItem(tx, w, ba.shipmentId, { status: 'picking', pickerClaimedAt: doneAt });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      const bb = await f.seedBox(tx, w, [fb.foItemId], { status: 'planned', plannedAt });
      await f.seedWorkItem(tx, w, bb.shipmentId, { status: 'completed', completedAt: doneAt });
      return [a.salesOrderId, b.salesOrderId];
    });
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));
    expect(byStage.pick).toMatchObject({ state: 'picking', estimatedEnteredAt: doneAt.toISOString() });
    expect(byStage.dispatch).toMatchObject({ state: 'awaiting_dispatch', estimatedEnteredAt: doneAt.toISOString() });
  });

  // Review Focus 2
  it('회수 뒤 다시 계획된 상자의 옛 completed 작업 항목은 dispatch 로 보지 않는다', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fo.foItemId], {
        status: 'planned',
        plannedAt: new Date('2026-10-05T12:00:00.000Z'),
      });
      await f.seedWorkItem(tx, w, box.shipmentId, {
        status: 'completed',
        completedAt: new Date('2026-10-04T00:00:00.000Z'),
      });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'waybill', state: 'none' });
  });

  it('상자 둘 중 하나만 발송 → 뒤처진 쪽(plan)', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'shipped', shippedAt: new Date('2026-10-05T00:00:00.000Z') });
      const draft = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      await f.seedFullReservations(tx, w, { foId: fo.foId, foItemIds: [fo.foItemId], box: draft });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'plan' });
  });

  it('상자 전부 delivered → 종료 delivered', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'delivered' });
  });

  it('shipped·in_transit → track, 진입 = shipped_at', async () => {
    const at = new Date('2026-10-04T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'in_transit', shippedAt: at });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'track', state: 'in_transit', estimatedEnteredAt: at.toISOString() });
  });

  // 입점사 상자는 상자로 판정한다(K3 PR4, N7) — 단계 술어는 fulfillment/shipment/supplier-shipment-stage.ts 와 같다
  describe('입점사 상자', () => {
    /** 입점사 상자 하나만 있는 주문. FO 는 ready(투영이 입점사 라인을 예약된 것과 같이 센다, N4) */
    async function supplierOnly(
      tx: DbTx,
      w: f.World,
      box: Omit<Parameters<typeof f.seedBox>[3], 'supplierId'>,
      handoffAt?: Date,
    ) {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      const supplierId = await f.seedDirectSupplier(tx);
      const supplierHandoffId = handoffAt ? await f.seedHandoff(tx, supplierId, handoffAt) : undefined;
      const b = await f.seedBox(tx, w, [fo.foItemId], { ...box, supplierId, supplierHandoffId });
      return { orderId: o.salesOrderId, boxIds: [b.shipmentId] };
    }
    const onlyBox = (boxes: Map<string, unknown>) => [...boxes.values()][0];

    it('넘기지 않은 입점사 상자 → dispatch/drop_ship_pending, 진입 = opened_at(예약 0 인데 reserve 가 아니다)', async () => {
      const at = new Date('2026-10-05T00:00:00.000Z');
      const { order, boxes } = await judgeOrderAndBoxes((tx, w) =>
        supplierOnly(tx, w, { status: 'draft', openedAt: at }),
      );
      const expected = { stage: 'dispatch', state: 'drop_ship_pending', estimatedEnteredAt: at.toISOString() };
      expect(order).toMatchObject({ ...expected, outcome: null });
      expect(onlyBox(boxes)).toMatchObject(expected);
    });

    it('넘긴 입점사 상자 → track/drop_ship_forwarded, 진입 = 묶음 created_at', async () => {
      const handoffAt = new Date('2026-10-05T06:00:00.000Z');
      const { order, boxes } = await judgeOrderAndBoxes((tx, w) =>
        supplierOnly(tx, w, { status: 'draft', openedAt: new Date('2026-10-01T00:00:00.000Z') }, handoffAt),
      );
      const expected = { stage: 'track', state: 'drop_ship_forwarded', estimatedEnteredAt: handoffAt.toISOString() };
      expect(order).toMatchObject(expected);
      expect(onlyBox(boxes)).toMatchObject(expected);
    });

    // Review Focus — 못 보냄 라인과 정상 라인이 섞여도 상자는 «못 보냄»(넘김 여부와 무관)
    it('못 보냄 라인이 있는 입점사 상자 → dispatch/drop_ship_unfulfillable, 진입 = 보고 시각, 바로 갇힘', async () => {
      const reportedAt = new Date('2026-10-06T02:59:00.000Z');
      const { order, boxes } = await judgeOrderAndBoxes(async (tx, w) => {
        const o = await f.seedOrder(tx);
        await f.seedBacklog(tx, o.salesOrderId, 'completed');
        const fo = await f.seedFo(tx, w, o, { status: 'ready' });
        const second = await addFoItem(tx, w, o, fo.foId);
        const supplierId = await f.seedDirectSupplier(tx);
        const handoff = await f.seedHandoff(tx, supplierId, new Date('2026-10-05T00:00:00.000Z'));
        const b = await f.seedBox(tx, w, [fo.foItemId, second], {
          status: 'draft',
          supplierId,
          supplierHandoffId: handoff,
          unfulfillable: { lineIndex: 1, reason: '품절', at: reportedAt },
        });
        return { orderId: o.salesOrderId, boxIds: [b.shipmentId] };
      });
      const expected = {
        stage: 'dispatch',
        state: 'drop_ship_unfulfillable',
        estimatedEnteredAt: reportedAt.toISOString(),
      };
      expect(order).toMatchObject(expected);
      expect(onlyBox(boxes)).toMatchObject(expected);
      // 1분 전 보고 — 단계 기준(dispatch 1시간)이면 아직이지만 «못 보냄»은 관리자 개입이라 바로 갇힘이다
      expect(isStuck('dispatch', reportedAt, now)).toBe(false);
      expect(isStuck('dispatch', reportedAt, now, order.state)).toBe(true);
    });

    it('못 보냄 라인이 둘이면 진입은 가장 이른 보고 시각, 넘기지 않은 상자여도 «못 보냄»', async () => {
      const earlier = new Date('2026-10-04T00:00:00.000Z');
      const r = await one(async (tx, w) => {
        const o = await f.seedOrder(tx);
        const fo = await f.seedFo(tx, w, o, { status: 'ready' });
        const second = await addFoItem(tx, w, o, fo.foId);
        const b = await f.seedBox(tx, w, [fo.foItemId, second], {
          status: 'draft',
          supplierId: await f.seedDirectSupplier(tx),
          unfulfillable: { lineIndex: 0, reason: '단종', at: new Date('2026-10-05T00:00:00.000Z') },
        });
        await tx
          .update(wmsTables.shipmentLines)
          .set({
            unfulfillableReason: '품절',
            unfulfillableReportedAt: earlier,
            unfulfillableReportedBy: 'op-supplier',
          })
          .where(eq(wmsTables.shipmentLines.id, b.lineIds[1]));
        return o.salesOrderId;
      });
      expect(r).toMatchObject({
        stage: 'dispatch',
        state: 'drop_ship_unfulfillable',
        estimatedEnteredAt: earlier.toISOString(),
      });
    });

    it('발송된 입점사 상자 → done — 주문의 유일한 단위면 배송완료된 창고 상자와 같은 결과', async () => {
      const shippedAt = new Date('2026-10-05T00:00:00.000Z');
      const [supplier, warehouse] = await judgeIn(async (tx, w) => {
        const a = await supplierOnly(tx, w, { status: 'shipped', shippedAt }, new Date('2026-10-04T00:00:00.000Z'));
        const b = await f.seedOrder(tx);
        await f.seedBacklog(tx, b.salesOrderId, 'completed');
        const fb = await f.seedFo(tx, w, b, { status: 'completed' });
        await f.seedBox(tx, w, [fb.foItemId], { status: 'delivered' });
        return [a.orderId, b.salesOrderId];
      });
      expect(supplier).toMatchObject({ stage: null, state: null, outcome: 'delivered' });
      expect({ stage: supplier.stage, state: supplier.state, outcome: supplier.outcome }).toEqual({
        stage: warehouse.stage,
        state: warehouse.state,
        outcome: warehouse.outcome,
      });
    });

    it('상자별 결과 — 발송된 입점사 상자는 done', async () => {
      const { boxes } = await judgeOrderAndBoxes((tx, w) =>
        supplierOnly(tx, w, { status: 'shipped', shippedAt: new Date('2026-10-05T00:00:00.000Z') }, new Date()),
      );
      expect(onlyBox(boxes)).toMatchObject({ stage: 'done', state: null });
    });

    // Review Focus — 넘긴 입점사 상자 + 피킹 중 창고 상자: 대표는 더 뒤처진 창고 pick
    it('넘긴 입점사 상자 + 피킹 중 창고 상자 → 대표 pick, 상자별로는 각자', async () => {
      const claimedAt = new Date('2026-10-06T01:00:00.000Z');
      const { order, boxes } = await judgeOrderAndBoxes(async (tx, w) => {
        const o = await f.seedOrder(tx);
        await f.seedBacklog(tx, o.salesOrderId, 'completed');
        const fo = await f.seedFo(tx, w, o, { status: 'processing' });
        const second = await addFoItem(tx, w, o, fo.foId);
        const wh = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', plannedAt: claimedAt });
        await f.seedFullReservations(tx, w, { foId: fo.foId, foItemIds: [fo.foItemId], box: wh });
        await f.seedWorkItem(tx, w, wh.shipmentId, { status: 'picking', pickerClaimedAt: claimedAt });
        const supplierId = await f.seedDirectSupplier(tx);
        const sup = await f.seedBox(tx, w, [second], {
          status: 'draft',
          supplierId,
          supplierHandoffId: await f.seedHandoff(tx, supplierId, new Date('2026-10-05T00:00:00.000Z')),
        });
        return { orderId: o.salesOrderId, boxIds: [wh.shipmentId, sup.shipmentId] };
      });
      const [wh, sup] = [...boxes.values()];
      expect(order).toMatchObject({ stage: 'pick', state: 'picking', estimatedEnteredAt: claimedAt.toISOString() });
      expect(wh).toMatchObject({ stage: 'pick', state: 'picking' });
      expect(sup).toMatchObject({ stage: 'track', state: 'drop_ship_forwarded' });
    });

    it('CANCEL_REPLAN_PENDING 입점사 상자 → cancel(복구 갈래가 먼저)', async () => {
      const cancelAt = new Date('2026-10-05T00:00:00.000Z');
      const { order, boxes } = await judgeOrderAndBoxes(async (tx, w) => {
        const built = await supplierOnly(
          tx,
          w,
          { status: 'draft', recoveryCode: 'CANCEL_REPLAN_PENDING' },
          new Date('2026-10-04T00:00:00.000Z'),
        );
        await f.seedCancellation(tx, built.orderId, cancelAt);
        return built;
      });
      expect(order).toMatchObject({
        stage: 'cancel',
        state: 'CANCEL_REPLAN_PENDING',
        estimatedEnteredAt: cancelAt.toISOString(),
      });
      expect(onlyBox(boxes)).toMatchObject({ stage: 'cancel', state: 'CANCEL_REPLAN_PENDING' });
    });
  });

  it('취소됐는데 상자가 남음 → cancel/open_shipment, 진입 = 마지막 취소 시각', async () => {
    const at = new Date('2026-09-01T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', plannedAt: at });
      await f.seedCancellation(tx, o.salesOrderId, at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel', state: 'open_shipment', estimatedEnteredAt: at.toISOString() });
  });

  it('취소됐고 상자는 닫혔는데 확정 예약이 남음 → cancel/open_reservation', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'canceled' });
      await f.seedConfirmedReservation(tx, w, { foId: fo.foId, foItemId: fo.foItemId, shipmentLineId: box.lineIds[0] });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel', state: 'open_reservation' });
  });

  it('취소됐고 남은 게 없음 → 종료 cancelled', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'canceled' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'cancelled' });
  });

  it('끝난(applied) 취소 요청은 단계에 영향 없음 — 요청 행이 없는 주문과 같은 판정', async () => {
    const [withRow, without] = await judgeIn(async (tx) => {
      const a = await f.seedOrder(tx);
      await tx.insert(wmsTables.salesOrderAmendments).values({
        salesOrderId: a.salesOrderId,
        amendmentKind: 'commercial',
        reasonCode: 'CHANNEL_CANCEL_REQUEST',
        deltas: [],
        origin: 'operator',
        status: 'applied',
      });
      const b = await f.seedOrder(tx);
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(withRow.stage).not.toBe('cancel_request');
    expect({ stage: withRow.stage, state: withRow.state, outcome: withRow.outcome }).toEqual({
      stage: without.stage,
      state: without.state,
      outcome: without.outcome,
    });
  });

  it('정산 중 — 취소된 판매주문이어도 종료가 아니라 cancel_request/settle_in_progress, 진입 = 확정 시각', async () => {
    const at = new Date('2026-10-06T02:50:00.000Z');
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, o.salesOrderId, { createdAt: at });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({
      stage: 'cancel_request',
      state: 'settle_in_progress',
      outcome: null,
      estimatedEnteredAt: at.toISOString(),
    });
  });

  it('확정 후 30분 초과 → settle_delayed · 거절 → settle_refused', async () => {
    const [delayed, refused] = await judgeIn(async (tx) => {
      const a = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, a.salesOrderId, { createdAt: new Date('2026-10-06T02:29:00.000Z') });
      const b = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, b.salesOrderId, { createdAt: new Date('2026-10-06T02:55:00.000Z'), state: 'refused' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect([delayed, refused].map((r) => r.state).sort()).toEqual(['settle_delayed', 'settle_refused']);
  });

  it('정확히 30분은 아직 정산 중 — «넘어야» 지연', async () => {
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:30:00.000Z') });
      return o.salesOrderId;
    });
    expect(r.state).toBe('settle_in_progress');
  });

  it('정산 중 요청 둘 → 가장 나쁜 상태가 대표(거절 > 지연 > 정산 중)', async () => {
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:58:00.000Z') });
      await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:59:00.000Z'), state: 'refused' });
      return o.salesOrderId;
    });
    expect(r.state).toBe('settle_refused');
  });

  it('정산 중 부분취소의 남은 상자 — 상자 판정의 주문 규칙은 cancel_settle(상자 규칙 제외 아님)', async () => {
    let judged: Awaited<ReturnType<OrderProgressReader['judgeShipment']>>;
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as DbTx;
        const w = await f.seedWorld(tx);
        const o = await f.seedOrder(tx);
        const fo = await f.seedFo(tx, w, o, { status: 'ready' });
        const box = await f.seedBox(tx, w, [fo.foItemId], {
          status: 'planned',
          plannedAt: new Date('2026-10-06T01:00:00.000Z'),
        });
        await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:58:00.000Z') });
        judged = await reader.judgeShipment(box.shipmentId, tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(judged!.orderRules).toEqual(['cancel_settle']);
  });

  /** 정산 중 요청이 있는 주문의 상자 하나를 상자 판정과 주문 판정으로 함께 본다 */
  async function judgeSettlingBox(soStatus: 'cancelled' | 'shipped') {
    let shipment: Awaited<ReturnType<OrderProgressReader['judgeShipment']>>;
    let order: JudgedRow | undefined;
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as DbTx;
        const w = await f.seedWorld(tx);
        const o = await f.seedOrder(tx, { status: soStatus });
        const fo = await f.seedFo(tx, w, o, { status: 'ready' });
        const box = await f.seedBox(tx, w, [fo.foItemId], {
          status: 'planned',
          plannedAt: new Date('2026-10-06T01:00:00.000Z'),
        });
        await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:58:00.000Z'), state: 'refused' });
        shipment = await reader.judgeShipment(box.shipmentId, tx);
        [order] = await reader.judge([o.salesOrderId], now, tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    return { shipment: shipment!, order: order! };
  }

  it('취소된 판매주문 + 정산 중 + 열린 상자 — 상자 판정은 취소 사실(cancel_open)을 지키고, 주문 판정은 정산 중이 앞선다', async () => {
    const { shipment, order } = await judgeSettlingBox('cancelled');
    // 25번의 CANCELLED_ORDER_RULES 가 이 값을 본다 — cancel_settle 로 덮이면 취소된 주문의 합포장을 재개한다
    expect(shipment.orderRules).toEqual(['cancel_open']);
    expect(order).toMatchObject({ stage: 'cancel_request', state: 'settle_refused', outcome: null });
  });

  it('셀메이트로 출고된 판매주문 + 정산 중(부분취소) — 상자 판정은 external_shipped(D16 제외), 주문 판정은 정산 중', async () => {
    const { shipment, order } = await judgeSettlingBox('shipped');
    expect(shipment.orderRules).toEqual(['external_shipped']);
    expect(order).toMatchObject({ stage: 'cancel_request', state: 'settle_refused', outcome: null });
  });

  it('살아 있는 주문의 상자가 CANCEL_REPLAN_PENDING → cancel/<코드>, 진입 = 마지막 취소 시각', async () => {
    const at = new Date('2026-09-20T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      await f.seedCancellation(tx, o.salesOrderId, at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel', state: 'CANCEL_REPLAN_PENDING', estimatedEnteredAt: at.toISOString() });
  });

  it('취소됐고 상자에 복구 코드(CONSOLIDATION_PENDING)가 있음 → cancel/<코드>', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', recoveryCode: 'CONSOLIDATION_PENDING' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel', state: 'CONSOLIDATION_PENDING' });
  });

  it('CONSOLIDATION_PENDING → pick, 모르는 복구 코드 → unclassified', async () => {
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      await f.seedBox(tx, w, [fa.foItemId], { status: 'planned', recoveryCode: 'CONSOLIDATION_PENDING' });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      await f.seedBox(tx, w, [fb.foItemId], { status: 'recovery_required', recoveryCode: 'SOMETHING_NEW' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows.map((r) => [r.stage, r.state])).toEqual(
      expect.arrayContaining([
        ['pick', 'CONSOLIDATION_PENDING'],
        ['unclassified', 'SOMETHING_NEW'],
      ]),
    );
  });

  it('배송완료 뒤 열린 반품 예정 → return_exchange/return:expected, 시각은 접수 시각', async () => {
    const at = new Date('2026-10-05T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      await f.seedReturn(tx, o.salesOrderId, 'expected', at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({
      stage: 'return_exchange',
      state: 'return:expected',
      estimatedEnteredAt: at.toISOString(),
    });
  });

  it.each(['held', 'refund_pending'] as const)('보류·환불 실패도 열린 반품이다 → return:%s', async (status) => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      await f.seedReturn(tx, o.salesOrderId, status);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'return_exchange', state: `return:${status}` });
  });

  it.each(['settled', 'cancelled'] as const)('%s 반품만 있으면 반품 단계가 아니다', async (status) => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      await f.seedReturn(tx, o.salesOrderId, status);
      return o.salesOrderId;
    });
    expect(r.stage).not.toBe('return_exchange');
  });

  it('FO 는 있는데 세는 상자가 없음 → unclassified/no_units', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      await f.seedFo(tx, w, o, { status: 'ready' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'unclassified', state: 'no_units' });
  });

  // Review Focus 1
  it('한 상자에 두 판매주문(합포장) → 두 주문 모두 그 상자로 판정', async () => {
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fa.foItemId, fb.foItemId], { status: 'draft' });
      await f.seedConfirmedReservation(tx, w, { foId: fa.foId, foItemId: fa.foItemId, shipmentLineId: box.lineIds[0] });
      await f.seedConfirmedReservation(tx, w, { foId: fb.foId, foItemId: fb.foItemId, shipmentLineId: box.lineIds[1] });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.stage === 'plan')).toBe(true);
  });
});
