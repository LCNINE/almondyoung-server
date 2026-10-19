import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import { wireLogistics, Wired } from '../services/__support__/logistics-wiring';
import { boxLinesOf, seedOrderWithDraftBox } from '../draft-box/__support__/draft-box-fixtures';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { editShipmentManifest, ManifestEditDeps } from './shipment-manifest-edit';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('editShipmentManifest', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const S = wmsTables.shipments;
  const L = wmsTables.shipmentLines;

  function makeDeps() {
    const wired = wireLogistics(makeDbService(db));
    const recompute = jest.fn((id: string, tx: DbTx) => wired.shipmentReservations.recompute(id, tx));
    const deps: ManifestEditDeps = { invariant: new FulfillmentInvariantService(), reservations: { recompute } };
    return { deps, recompute, wired };
  }

  /** 줄 둘(A, B)이 든 draft 상자 하나. 예약까지 실제 서비스로 만든다. */
  async function box(tx: DbTx, wired: Wired) {
    const fx = await seedOrderWithDraftBox(tx, wired, {
      lines: [
        { quantity: 2, qtyPerUnits: [1] },
        { quantity: 2, qtyPerUnits: [1] },
      ],
    });
    const lines = await boxLinesOf(tx, fx.shipmentId);
    return { shipmentId: fx.shipmentId, lineA: lines[0].id, lineB: lines[1].id, warehouseId: fx.warehouseId };
  }
  const shipment = async (tx: DbTx, id: string) => (await tx.select().from(S).where(eq(S.id, id)))[0];
  const line = async (tx: DbTx, id: string) => (await tx.select().from(L).where(eq(L.id, id)))[0];

  it('줄 수량을 바꾸면 그 상자 manifest +1 한 번, 줄 버전 +1, 예약 재계산', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, recompute, wired } = makeDeps();
      const b = await box(tx, wired);
      const s0 = await shipment(tx, b.shipmentId);
      const l0 = await line(tx, b.lineA);
      await editShipmentManifest(
        deps,
        { shipmentIds: [b.shipmentId], allow: ['draft'] },
        async (w) => {
          await w.setLineQty(b.lineA, b.shipmentId, 2);
          await w.setLineQty(b.lineA, b.shipmentId, 2);
        },
        tx,
      );
      expect((await shipment(tx, b.shipmentId)).manifestVersion).toBe(s0.manifestVersion + 1);
      expect((await line(tx, b.lineA)).lineVersion).toBe(l0.lineVersion + 2);
      expect(recompute).toHaveBeenCalledTimes(1);
      expect(recompute).toHaveBeenCalledWith(b.shipmentId, tx);
    });
  });

  it('줄을 새 상자로 옮기면 원본 +1, 새 상자 1, 둘 다 재계산', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, recompute, wired } = makeDeps();
      const b = await box(tx, wired);
      const s0 = await shipment(tx, b.shipmentId);
      const newId = await editShipmentManifest(
        deps,
        { shipmentIds: [b.shipmentId], allow: ['draft'] },
        async (w) => {
          const created = await w.createShipment({
            warehouseId: b.warehouseId,
            status: 'draft',
            shippingProfileId: null,
            recipientSnapshot: s0.recipientSnapshot,
            entrancePassword: null,
          });
          await w.moveLine(b.lineB, b.shipmentId, created.id);
          return created.id;
        },
        tx,
      );
      expect((await shipment(tx, b.shipmentId)).manifestVersion).toBe(s0.manifestVersion + 1);
      expect((await shipment(tx, newId)).manifestVersion).toBe(1);
      expect((await line(tx, b.lineB)).shipmentId).toBe(newId);
      expect(recompute.mock.calls.map((c) => c[0])).toEqual([b.shipmentId, newId]);
    });
  });

  it('비밀번호만 바꾸면 manifest 그대로, 재계산 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, recompute, wired } = makeDeps();
      const b = await box(tx, wired);
      const s0 = await shipment(tx, b.shipmentId);
      await editShipmentManifest(
        deps,
        { shipmentIds: [b.shipmentId], allow: ['draft'] },
        (w) => w.setEntrancePassword(b.shipmentId, '1234'),
        tx,
      );
      const s1 = await shipment(tx, b.shipmentId);
      expect(s1.entrancePassword).toBe('1234');
      expect(s1.manifestVersion).toBe(s0.manifestVersion);
      expect(recompute).not.toHaveBeenCalled();
    });
  });

  it('수령인을 바꾸면 manifest +1, 재계산 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, recompute, wired } = makeDeps();
      const b = await box(tx, wired);
      const s0 = await shipment(tx, b.shipmentId);
      await editShipmentManifest(
        deps,
        { shipmentIds: [b.shipmentId], allow: ['draft'] },
        (w) => w.reviseRecipient(b.shipmentId, { recipientName: 'New' }),
        tx,
      );
      const s1 = await shipment(tx, b.shipmentId);
      expect(s1.manifestVersion).toBe(s0.manifestVersion + 1);
      expect(s1.recipientSnapshot).toEqual({ recipientName: 'New' });
      expect(recompute).not.toHaveBeenCalled();
    });
  });

  it('allow 밖 상태면 body 전에 Error', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, wired } = makeDeps();
      const b = await box(tx, wired);
      const body = jest.fn();
      await expect(
        editShipmentManifest(deps, { shipmentIds: [b.shipmentId], allow: ['planned'] }, body, tx),
      ).rejects.toThrow(/allowed planned/);
      expect(body).not.toHaveBeenCalled();
    });
  });

  it('활성 송장이 있으면 assertShipmentHasNoActiveWaybill 의 에러, body 안 돎', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, wired } = makeDeps();
      const b = await box(tx, wired);
      const s0 = await shipment(tx, b.shipmentId);
      await tx.insert(wmsTables.waybills).values({
        shipmentId: b.shipmentId,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo: `K2-${b.shipmentId}`,
        manifestVersion: s0.manifestVersion,
        recipientHash: 'h'.repeat(64),
      });
      const body = jest.fn();
      await expect(
        editShipmentManifest(deps, { shipmentIds: [b.shipmentId], allow: ['draft'] }, body, tx),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_ACTIVE_INVOICE' } });
      expect(body).not.toHaveBeenCalled();
    });
  });

  it('edit 밖 상자에 쓰면 Error', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, wired } = makeDeps();
      const b = await box(tx, wired);
      const other = await box(tx, wired);
      await expect(
        editShipmentManifest(
          deps,
          { shipmentIds: [b.shipmentId], allow: ['draft'] },
          (w) => w.setLineQty(other.lineA, other.shipmentId, 1),
          tx,
        ),
      ).rejects.toThrow(/outside this edit/);
    });
  });

  it('줄이 그 상자에 없으면 Error', async () => {
    await inRollbackTx(db, async (tx) => {
      const { deps, wired } = makeDeps();
      const b = await box(tx, wired);
      const other = await box(tx, wired);
      await expect(
        editShipmentManifest(
          deps,
          { shipmentIds: [b.shipmentId, other.shipmentId], allow: ['draft'] },
          (w) => w.setLineQty(other.lineA, b.shipmentId, 1),
          tx,
        ),
      ).rejects.toThrow(/is not in shipment/);
    });
  });
});
