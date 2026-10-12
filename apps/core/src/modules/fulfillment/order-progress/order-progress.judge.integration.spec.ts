import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressReader, JudgedRow } from './order-progress.reader';
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
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
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
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', openedAt: at });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'plan', state: 'awaiting_plan', estimatedEnteredAt: at.toISOString() });
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
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
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

  it('직배 pending → dispatch/drop_ship_pending, forwarded → track', async () => {
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      await f.seedFo(tx, w, a, { dropShip: 'pending' });
      const b = await f.seedOrder(tx);
      await f.seedFo(tx, w, b, { dropShip: 'forwarded' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows.map((r) => [r.stage, r.state])).toEqual(
      expect.arrayContaining([
        ['dispatch', 'drop_ship_pending'],
        ['track', 'drop_ship_forwarded'],
      ]),
    );
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

  it('배송완료 뒤 열린 반품 → return_exchange/return:requested', async () => {
    const at = new Date('2026-10-05T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      await f.seedReturn(tx, o.salesOrderId, 'requested', at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({
      stage: 'return_exchange',
      state: 'return:requested',
      estimatedEnteredAt: at.toISOString(),
    });
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
      await f.seedBox(tx, w, [fa.foItemId, fb.foItemId], { status: 'draft' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.stage === 'plan')).toBe(true);
  });
});
