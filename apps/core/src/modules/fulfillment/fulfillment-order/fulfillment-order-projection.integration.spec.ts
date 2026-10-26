import * as postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { reprojectFulfillmentOrders } from './fulfillment-order-projection';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('FO 투영 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  const foi = (tx: DbTx, id: string) =>
    tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, id))
      .then((r) => r[0]);
  const fo = (tx: DbTx, id: string) =>
    tx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, id))
      .then((r) => r[0]);
  const setFoi = (tx: DbTx, id: string, set: Partial<typeof wmsTables.fulfillmentOrderItems.$inferInsert>) =>
    tx.update(wmsTables.fulfillmentOrderItems).set(set).where(eq(wmsTables.fulfillmentOrderItems.id, id));

  /** qty 짜리 FO 하나 — 투영 전 상태는 일부러 어긋난 값으로 둔다(투영이 덮어쓰는지 보려고). */
  async function seed(tx: DbTx, qty: number) {
    const w = await f.seedWorld(tx);
    const order = await f.seedOrder(tx, { quantity: qty });
    const ids = await f.seedFo(tx, w, order, { qty, status: 'processing' });
    return { w, ...ids };
  }

  it('상자 라인이 다 확정 예약되면 FO·FOI ready, reservedQty 가 예약 합', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, foId, foItemId } = await seed(tx, 2);
      const box = await f.seedBox(tx, w, [foItemId], { status: 'draft', qty: [2] });
      await f.seedFullReservations(tx, w, { foId, foItemIds: [foItemId], box, qty: [2] });

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await foi(tx, foItemId)).toMatchObject({ status: 'ready', reservedQty: 2 });
      expect(await fo(tx, foId)).toMatchObject({
        status: 'ready',
        totalReservedQty: 2,
        reservationFailureReason: null,
      });
    });
  });

  it('입점사 상자 라인만 있는 FO 를 투영하면 FO ready, reserved_qty 0, total_reserved_qty 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, foId, foItemId } = await seed(tx, 2);
      const supplierId = await f.seedDirectSupplier(tx);
      await f.seedBox(tx, w, [foItemId], { status: 'draft', qty: [2], supplierId });

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await foi(tx, foItemId)).toMatchObject({ status: 'ready', reservedQty: 0 });
      expect(await fo(tx, foId)).toMatchObject({ status: 'ready', totalReservedQty: 0 });
    });
  });

  it('창고 상자 전량 확정 예약 + 입점사 상자 → FO ready, total_reserved_qty = 창고 예약 합', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, foId, foItemId } = await seed(tx, 4);
      const supplierId = await f.seedDirectSupplier(tx);
      const box = await f.seedBox(tx, w, [foItemId], { status: 'draft', qty: [2] });
      await f.seedFullReservations(tx, w, { foId, foItemIds: [foItemId], box, qty: [2] });
      await f.seedBox(tx, w, [foItemId], { status: 'draft', qty: [2], supplierId });

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await foi(tx, foItemId)).toMatchObject({ status: 'ready', reservedQty: 2 });
      expect(await fo(tx, foId)).toMatchObject({ status: 'ready', totalReservedQty: 2 });
    });
  });

  it('예약이 일부면 partially_reserved', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, foId, foItemId } = await seed(tx, 2);
      const box = await f.seedBox(tx, w, [foItemId], { status: 'draft', qty: [2] });
      await f.seedConfirmedReservation(tx, w, { foId, foItemId, shipmentLineId: box.lineIds[0], quantity: 1 });

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await fo(tx, foId)).toMatchObject({ status: 'partially_reserved', totalReservedQty: 1 });
    });
  });

  it('canceled 상자의 라인은 활성 라인이 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, foId, foItemId } = await seed(tx, 2);
      const live = await f.seedBox(tx, w, [foItemId], { status: 'draft' });
      const dead = await f.seedBox(tx, w, [foItemId], { status: 'canceled' });
      await f.seedConfirmedReservation(tx, w, { foId, foItemId, shipmentLineId: live.lineIds[0] });
      await f.seedConfirmedReservation(tx, w, { foId, foItemId, shipmentLineId: dead.lineIds[0] });

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await foi(tx, foItemId)).toMatchObject({ reservedQty: 1 });
      expect(await fo(tx, foId)).toMatchObject({ status: 'partially_reserved' });
    });
  });

  it('recovery_required 상자에 걸린 FOI 는 recovery_required', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, foId, foItemId } = await seed(tx, 1);
      await f.seedBox(tx, w, [foItemId], { status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' });

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await foi(tx, foItemId)).toMatchObject({ status: 'recovery_required' });
      expect(await fo(tx, foId)).toMatchObject({ status: 'recovery_required' });
    });
  });

  it('전량 취소면 canceled, canceledAt 을 at 으로 찍는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { foId, foItemId } = await seed(tx, 2);
      await setFoi(tx, foItemId, { canceledQty: 2 });
      const at = new Date('2026-10-25T00:00:00Z');

      await reprojectFulfillmentOrders(tx, [foId], at);

      expect(await foi(tx, foItemId)).toMatchObject({ status: 'canceled' });
      expect(await fo(tx, foId)).toMatchObject({ status: 'canceled', canceledAt: at });
    });
  });

  it('이미 canceledAt 이 있으면 그 값을 지킨다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { foId, foItemId } = await seed(tx, 1);
      const t0 = new Date('2026-10-01T00:00:00Z');
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ canceledAt: t0 })
        .where(eq(wmsTables.fulfillmentOrders.id, foId));
      await setFoi(tx, foItemId, { canceledQty: 1 });

      await reprojectFulfillmentOrders(tx, [foId], new Date('2026-10-25T00:00:00Z'));

      expect(await fo(tx, foId)).toMatchObject({ status: 'canceled', canceledAt: t0 });
    });
  });

  it('항목이 0 개인 FO 는 canceled', async () => {
    await inRollbackTx(db, async (tx) => {
      const { foId, foItemId } = await seed(tx, 1);
      await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await fo(tx, foId)).toMatchObject({ status: 'canceled' });
    });
  });

  it('예약 없는 FO 부분 감소 뒤는 created', async () => {
    await inRollbackTx(db, async (tx) => {
      const { foId, foItemId } = await seed(tx, 3);
      await setFoi(tx, foItemId, { canceledQty: 1 });

      await reprojectFulfillmentOrders(tx, [foId]);

      expect(await foi(tx, foItemId)).toMatchObject({ status: 'created', reservedQty: 0 });
      expect(await fo(tx, foId)).toMatchObject({ status: 'created', canceledAt: null });
    });
  });

  it('같은 tx 에서 두 번 불러도 결과가 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, foId, foItemId } = await seed(tx, 2);
      const box = await f.seedBox(tx, w, [foItemId], { status: 'draft', qty: [2] });
      await f.seedConfirmedReservation(tx, w, { foId, foItemId, shipmentLineId: box.lineIds[0], quantity: 1 });
      const pick = (r: { status: string; canceledAt: Date | null; totalReservedQty: number }) => ({
        status: r.status,
        canceledAt: r.canceledAt,
        totalReservedQty: r.totalReservedQty,
      });

      await reprojectFulfillmentOrders(tx, [foId]);
      const first = { fo: pick(await fo(tx, foId)), foi: await foi(tx, foItemId) };
      await reprojectFulfillmentOrders(tx, [foId]);

      expect(pick(await fo(tx, foId))).toEqual(first.fo);
      expect(await foi(tx, foItemId)).toMatchObject({ status: first.foi.status, reservedQty: first.foi.reservedQty });
    });
  });

  it('중복 id 는 한 번, 빈 배열은 아무것도 안 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { foId } = await seed(tx, 1);

      await expect(reprojectFulfillmentOrders(tx, [foId, foId])).resolves.toBeUndefined();
      await expect(reprojectFulfillmentOrders(tx, [])).resolves.toBeUndefined();
      expect(await fo(tx, foId)).toMatchObject({ status: 'created' });
    });
  });
});
