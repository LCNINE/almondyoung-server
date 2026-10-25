import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../services/__support__';
import {
  seedHolder,
  seedShipmentLineFor,
  seedSku,
  seedWarehouseWithZone,
} from '../services/__support__/logistics-fixtures';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { openShipment, transitionShipments } from './shipment-lifecycle';
import { shipmentOwnerOf } from './shipment-owner';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('transitionShipments / openShipment', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const T = wmsTables.shipments;
  const L = wmsTables.shipmentLines;

  async function profileId(tx: DbTx): Promise<string> {
    const [p] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `k2-${randomUUID()}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'S', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'O' },
        returnAddressSnapshot: { address: 'R' },
        carrierAccountRef: 'k2',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    return p.id;
  }

  /** 줄 둘(A, B)이 든 상자. 처음엔 planned. */
  async function box(tx: DbTx) {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const lineA = await seedShipmentLineFor(tx, { skuId, warehouseId, qty: 2 });
    const lineB = await seedShipmentLineFor(tx, { skuId, warehouseId, qty: 2 });
    const [a] = await tx.select().from(L).where(eq(L.id, lineA));
    await tx.update(L).set({ shipmentId: a.shipmentId }).where(eq(L.id, lineB));
    return { shipmentId: a.shipmentId, lineA, lineB };
  }

  const shipment = async (tx: DbTx, id: string) => (await tx.select().from(T).where(eq(T.id, id)))[0];
  const line = async (tx: DbTx, id: string) => (await tx.select().from(L).where(eq(L.id, id)))[0];

  it('표에 없는 전이는 SQL 전에 Error', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      await tx.update(T).set({ status: 'delivered' }).where(eq(T.id, b.shipmentId));
      await expect(
        transitionShipments(tx, {
          shipmentIds: [b.shipmentId],
          from: ['delivered'],
          to: 'draft',
          stale: 'unreachable',
        }),
      ).rejects.toThrow(/Illegal shipment transition/);
      expect((await shipment(tx, b.shipmentId)).status).toBe('delivered');
    });
  });

  it('planned→draft 는 넷을 비우고 manifest +1, 검수 흔적 있는 줄만 버전 +1', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      await tx.update(L).set({ inspectedQty: 1 }).where(eq(L.id, b.lineA));
      await tx.update(T).set({ shippedAt: new Date(), deliveredAt: new Date() }).where(eq(T.id, b.shipmentId));
      const before = await shipment(tx, b.shipmentId);
      const a0 = await line(tx, b.lineA);
      const b0 = await line(tx, b.lineB);
      const rows = await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['planned'],
        to: 'draft',
        stale: 'unreachable',
      });
      expect(rows).toHaveLength(1);
      const after = await shipment(tx, b.shipmentId);
      expect(after.status).toBe('draft');
      expect(after.plannedAt).toBeNull();
      expect(after.shippedAt).toBeNull();
      expect(after.deliveredAt).toBeNull();
      expect(after.recoveryCode).toBeNull();
      expect(after.manifestVersion).toBe(before.manifestVersion + 1);
      const a1 = await line(tx, b.lineA);
      const b1 = await line(tx, b.lineB);
      expect(a1.inspectedQty).toBe(0);
      expect(a1.lineVersion).toBe(a0.lineVersion + 1);
      expect(b1.lineVersion).toBe(b0.lineVersion);
    });
  });

  it('forced 만 켜진 줄도 지우고 버전 +1', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      await tx.update(L).set({ forced: true }).where(eq(L.id, b.lineA));
      const a0 = await line(tx, b.lineA);
      await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['planned'],
        to: 'draft',
        stale: 'unreachable',
      });
      const a1 = await line(tx, b.lineA);
      expect(a1.forced).toBe(false);
      expect(a1.lineVersion).toBe(a0.lineVersion + 1);
    });
  });

  it('draft→planned 은 프로필이 같으면 manifest 그대로, 다르면 +1, plannedAt 을 찍는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      const p1 = await profileId(tx);
      const p2 = await profileId(tx);
      await tx.update(T).set({ status: 'draft', plannedAt: null, shippingProfileId: p1 }).where(eq(T.id, b.shipmentId));
      const v0 = (await shipment(tx, b.shipmentId)).manifestVersion;
      const at = new Date('2030-01-02T03:04:05Z');
      await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['draft'],
        to: 'planned',
        shippingProfileId: p1,
        at,
        stale: 'unreachable',
      });
      let s = await shipment(tx, b.shipmentId);
      expect(s.manifestVersion).toBe(v0);
      expect(s.plannedAt?.toISOString()).toBe(at.toISOString());
      expect(s.lastUpdated.toISOString()).toBe(at.toISOString());

      await tx.update(T).set({ status: 'draft' }).where(eq(T.id, b.shipmentId));
      await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['draft'],
        to: 'planned',
        shippingProfileId: p2,
        stale: 'unreachable',
      });
      s = await shipment(tx, b.shipmentId);
      expect(s.manifestVersion).toBe(v0 + 1);
      expect(s.shippingProfileId).toBe(p2);
    });
  });

  it('0행: unreachable 은 Error, ignore 는 [], 함수는 그 에러', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      const base = { shipmentIds: [b.shipmentId], from: ['draft'] as const, to: 'canceled' as const };
      await expect(transitionShipments(tx, { ...base, stale: 'unreachable' })).rejects.toThrow(/matched 0\/1/);
      await expect(transitionShipments(tx, { ...base, stale: 'ignore' })).resolves.toEqual([]);
      class Custom extends Error {}
      await expect(transitionShipments(tx, { ...base, stale: () => new Custom('x') })).rejects.toBeInstanceOf(Custom);
      expect((await shipment(tx, b.shipmentId)).status).toBe('planned');
    });
  });

  it('expect.manifestVersion 이 다르면 0행', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      const v = (await shipment(tx, b.shipmentId)).manifestVersion;
      const rows = await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['planned'],
        to: 'draft',
        expect: { manifestVersion: v + 1 },
        stale: 'ignore',
      });
      expect(rows).toEqual([]);
    });
  });

  it('여러 상자: 하나라도 안 맞으면 stale', async () => {
    await inRollbackTx(db, async (tx) => {
      const b1 = await box(tx);
      const b2 = await box(tx);
      await tx.update(T).set({ status: 'draft' }).where(eq(T.id, b2.shipmentId));
      await expect(
        transitionShipments(tx, {
          shipmentIds: [b1.shipmentId, b2.shipmentId],
          from: ['planned'],
          to: 'draft',
          stale: 'unreachable',
        }),
      ).rejects.toThrow(/matched 1\/2/);
    });
  });

  it('recovery_required 출발은 expect.recoveryCode 와 행의 코드가 같아야 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['planned'],
        to: 'recovery_required',
        recoveryCode: 'CANCEL_REPLAN_PENDING',
        stale: 'unreachable',
      });
      expect((await shipment(tx, b.shipmentId)).recoveryCode).toBe('CANCEL_REPLAN_PENDING');
      await expect(
        transitionShipments(tx, {
          shipmentIds: [b.shipmentId],
          from: ['recovery_required'],
          to: 'draft',
          stale: 'unreachable',
        }),
      ).rejects.toThrow(/expect\.recoveryCode is required/);
      // 코드가 다르면 0행
      const wrong = await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['recovery_required'],
        to: 'draft',
        expect: { recoveryCode: 'DISPATCH_RECALL_PENDING' },
        stale: 'ignore',
      });
      expect(wrong).toEqual([]);
      const ok = await transitionShipments(tx, {
        shipmentIds: [b.shipmentId],
        from: ['recovery_required'],
        to: 'draft',
        expect: { recoveryCode: 'CANCEL_REPLAN_PENDING' },
        stale: 'unreachable',
      });
      expect(ok[0].status).toBe('draft');
      expect(ok[0].recoveryCode).toBeNull();
    });
  });

  it('openShipment 은 draft 상자와 줄을 버전 1 로 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const b = await box(tx);
      const src = await line(tx, b.lineA);
      const [foi] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(inArray(wmsTables.fulfillmentOrderItems.id, [src.fulfillmentOrderItemId]));
      const s = await shipment(tx, b.shipmentId);
      const out = await openShipment(
        tx,
        {
          owner: shipmentOwnerOf(s),
          status: 'draft',
          shippingProfileId: null,
          recipientSnapshot: { recipientName: 'x' },
          entrancePassword: null,
        },
        [{ fulfillmentOrderItemId: foi.id, skuId: src.skuId, qty: 1 }],
      );
      expect(out.shipment.status).toBe('draft');
      expect(out.shipment.manifestVersion).toBe(1);
      expect(out.shipment.reservationVersion).toBe(1);
      expect(out.lines).toHaveLength(1);
      expect(out.lines[0].lineVersion).toBe(1);
      expect(out.lines[0].shipmentId).toBe(out.shipment.id);
    });
  });
  describe('입점사 draft → shipped (K3 PR5)', () => {
    it('입점사 draft 상자는 1행 shipped, shipped_at 이 찍힌다. 창고 draft 상자는 같은 호출에서 0행(stale 이면 throw)', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await f.seedWorld(tx);
        const o = await f.seedOrder(tx);
        const fo1 = await f.seedFo(tx, w, o);
        const supplierId = await f.seedDirectSupplier(tx);
        const sup = await f.seedBox(tx, w, [fo1.foItemId], { status: 'draft', supplierId });
        const wh = await f.seedBox(tx, w, [fo1.foItemId], { status: 'draft' });

        const rows = await transitionShipments(tx, {
          shipmentIds: [sup.shipmentId],
          from: ['draft'],
          to: 'shipped',
          stale: 'unreachable',
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('shipped');
        expect(rows[0].shippedAt).not.toBeNull();

        await expect(
          transitionShipments(tx, {
            shipmentIds: [wh.shipmentId],
            from: ['draft'],
            to: 'shipped',
            stale: 'unreachable',
          }),
        ).rejects.toThrow(/matched 0\/1/);
        const ignored = await transitionShipments(tx, {
          shipmentIds: [wh.shipmentId],
          from: ['draft'],
          to: 'shipped',
          stale: 'ignore',
        });
        expect(ignored).toHaveLength(0);
        expect((await shipment(tx, wh.shipmentId)).status).toBe('draft');
      });
    });

    it('openShipment 이 supplierHandoffId 를 칸에 쓴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await f.seedWorld(tx);
        const o = await f.seedOrder(tx);
        const fo = await f.seedFo(tx, w, o);
        const supplierId = await f.seedDirectSupplier(tx);
        const handoffId = await f.seedHandoff(tx, supplierId);
        const out = await openShipment(
          tx,
          {
            owner: { kind: 'supplier', supplierId },
            status: 'draft',
            shippingProfileId: null,
            recipientSnapshot: { recipientName: 'x' },
            entrancePassword: null,
            supplierHandoffId: handoffId,
          },
          [{ fulfillmentOrderItemId: fo.foItemId, skuId: w.skuId, qty: 1 }],
        );
        expect(out.shipment.supplierHandoffId).toBe(handoffId);
      });
    });
  });
});
