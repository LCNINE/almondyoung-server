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
    const amender = new DraftBoxAmender(
      dbService,
      logistics.shipmentReservations,
      invariant,
      new AuditService(dbService),
    );
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

      const result = await amender.amend(
        fx.shipmentId,
        target(fx.lineIds[0], 3, [{ skuId: a, qtyPerUnit: 2 }]),
        'it',
        actor,
        tx,
      );

      expect(result).toMatchObject({
        changed: true,
        manifestVersion: before.manifestVersion + 1,
        tombstoneShipmentId: null,
      });
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: a, qty: 6, reservedQty: 6 }]);
      expect(await itemsOf(tx, fx.fulfillmentOrderId)).toMatchObject([{ skuId: a, qty: 6, canceledQty: 0 }]);
      const [fo] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fx.fulfillmentOrderId));
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
      const fx = await seedOrderWithDraftBox(tx, logistics, {
        lines: [{ quantity: 2, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      const [a] = fx.skuIdsByLine[0];
      const [b] = fx.spareSkuIds;
      const [profile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({ name: `it-${randomUUID().slice(0, 8)}`, sourceType: 'in_house' })
        .returning();
      await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, b));

      const result = await amender.amend(
        fx.shipmentId,
        target(fx.lineIds[0], 2, [{ skuId: b, qtyPerUnit: 1 }]),
        'it',
        actor,
        tx,
      );

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

      await amender.amend(
        fx.shipmentId,
        target(fx.lineIds[0], 1, [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }]),
        'it',
        actor,
        tx,
      );

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

      expect(result).toEqual({
        changed: false,
        operationId: null,
        manifestVersion: before.manifestVersion,
        tombstoneShipmentId: null,
      });
      expect((await shipment(tx, fx.shipmentId)).manifestVersion).toBe(before.manifestVersion);
    });
  });

  it('draft 가 아닌 박스는 BOX_NOT_DRAFT', async () => {
    await inRollbackTx(db, async (tx) => {
      const { logistics, amender } = wire();
      const fx = await seedOrderWithDraftBox(tx, logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, fx.shipmentId));

      await expect(
        amender.amend(
          fx.shipmentId,
          target(fx.lineIds[0], 1, [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }]),
          'it',
          actor,
          tx,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BOX_NOT_DRAFT' }) });
    });
  });
});
