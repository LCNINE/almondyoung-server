import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { assertShipmentNotHeld, heldShipmentIds } from './cancel-request-hold';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function requestRow(tx: DbTx, salesOrderId: string, status: 'requested' | 'rejected' | 'applied') {
  await tx.insert(wmsTables.salesOrderAmendments).values({
    salesOrderId,
    amendmentKind: 'commercial',
    reasonCode: 'CHANNEL_CANCEL_REQUEST',
    deltas: [],
    origin: 'operator',
    status,
  });
}

describeIfDb('출고 보류 판정 (DB integration, rollback-only)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('열린 요청이 걸린 주문의 박스만 보류, 합포장이면 한 주문만 걸려도 박스 전체', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const held = await f.seedOrder(tx);
      const free = await f.seedOrder(tx);
      const heldFo = await f.seedFo(tx, w, held);
      const freeFo = await f.seedFo(tx, w, free);
      const merged = await f.seedBox(tx, w, [heldFo.foItemId, freeFo.foItemId], { status: 'planned' });
      const alone = await f.seedBox(tx, w, [freeFo.foItemId], { status: 'planned' });
      await requestRow(tx, held.salesOrderId, 'requested');
      expect(await heldShipmentIds(tx, [merged.shipmentId, alone.shipmentId])).toEqual(new Set([merged.shipmentId]));
      await expect(assertShipmentNotHeld(tx, merged.shipmentId)).rejects.toThrow('CANCEL_REQUESTED');
      await expect(assertShipmentNotHeld(tx, alone.shipmentId)).resolves.toBeUndefined();
    });
  });

  it.each(['rejected', 'applied'] as const)('%s 요청은 보류가 아니다', async (status) => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
      await requestRow(tx, o.salesOrderId, status);
      expect(await heldShipmentIds(tx, [box.shipmentId])).toEqual(new Set());
    });
  });

  it('빈 목록은 조회하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      expect(await heldShipmentIds(tx, [])).toEqual(new Set());
    });
  });
});
