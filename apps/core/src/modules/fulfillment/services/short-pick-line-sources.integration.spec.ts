import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedSpareStock, startedShortPickBox } from './__support__/short-pick-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Started = Awaited<ReturnType<typeof startedShortPickBox>>;

/** 임의 위치의 결품 보고 — 픽스처의 `report` 는 L1 만 보고하므로 같은 모양으로 위치만 바꾼다. 매번 최신 버전을 읽는다. */
async function reportAt(tx: DbTx, started: Started, sourceLocationId: string, shortQty: number) {
  const { box, wiring, sessionId } = started;
  const [session] = await tx
    .select()
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.id, sessionId));
  const [workItem] = await tx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
  const [line] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
  return wiring.shortPick.report(
    box.shipmentId,
    {
      workItemId: box.workItemId,
      expectedWorkItemLeaseVersion: workItem.leaseVersion,
      sessionId: session.id,
      expectedSessionVersion: session.version,
      expectedManifestVersion: shipment.manifestVersion,
      lines: [{ shipmentLineId: line.id, sourceLocationId, expectedLineVersion: line.lineVersion, shortQty }],
      reason: 'inventory_shortage',
    },
    `sp-${randomUUID()}`,
    { id: box.actorId, roles: ['master'] },
    tx,
  );
}

describeIfDb('재결품 후보 제외 (스펙 A4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('이미 채운 줄에서 또 결품이 나면 유령 가용이 있는 원래 위치로 보내지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 1, 'SPARE');
      const first = await started.report(1);
      expect(first.outcome).toBe('refilled');
      expect(first.refills).toEqual([expect.objectContaining({ sourceLocationId: spare.locationId, qty: 1 })]);

      const tail = await seedSpareStock(tx, started.box, 5, 'TAIL');
      const second = await reportAt(tx, started, spare.locationId, 1);
      expect(second.outcome).toBe('refilled');
      expect(second.refills).toEqual([expect.objectContaining({ sourceLocationId: tail.locationId, qty: 1 })]);
    });
  });

  it('한 위치뿐인 줄의 결품은 지금처럼 그 위치만 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 5, 'SPARE');
      const result = await started.report(1);
      expect(result.refills).toEqual([expect.objectContaining({ sourceLocationId: spare.locationId, qty: 1 })]);
    });
  });
});
