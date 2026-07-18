import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService, inRollbackTx, seedWarehouseWithZone } from '../services/__support__';
import { WaybillRepository } from './waybill.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillRepository (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let repo: WaybillRepository;
  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    repo = new WaybillRepository(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function shipment(tx: DbTx): Promise<string> {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const [s] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'planned' }).returning();
    return s.id;
  }
  const base = (shipmentId: string) => ({
    shipmentId,
    source: 'carrier' as const,
    carrier: 'HANJIN' as const,
    custOrdNo: 'AYTEST',
    manifestVersion: 1,
    recipientHash: 'a'.repeat(64),
  });

  it('pending → allocated CAS only fires from pending', async () => {
    await inRollbackTx(db, async (tx) => {
      const sid = await shipment(tx);
      const wb = await repo.insertPending(tx, base(sid));
      expect(wb.status).toBe('pending');
      const t = `T-${randomUUID().slice(0, 8)}`;
      expect(await repo.casToAllocated(tx, wb.id, t, { s_tml_cod: 'x' })).toBe(true);
      // 두번째 시도는 pending 아님 → false
      expect(await repo.casToAllocated(tx, wb.id, t, {})).toBe(false);
      const after = await repo.findById(tx, wb.id);
      expect(after?.status).toBe('allocated');
      expect(after?.trackingNo).toBe(t);
    });
  });

  it('casToUsed is idempotent and strict (0 rows when not dispatchable)', async () => {
    await inRollbackTx(db, async (tx) => {
      const sid = await shipment(tx);
      const [wb] = await tx
        .insert(wmsTables.waybills)
        .values({
          ...base(sid),
          status: 'registered',
          trackingNo: `T-${randomUUID().slice(0, 8)}`,
        })
        .returning();
      expect(await repo.casToUsed(tx, sid)).toBe(1); // registered→used
      expect(await repo.casToUsed(tx, sid)).toBe(1); // used→used 멱등
      // void 후엔 활성 dispatchable 없음 → 0
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, wb.id));
      expect(await repo.casToUsed(tx, sid)).toBe(0);
    });
  });

  it('findActiveByShipment ignores terminal rows', async () => {
    await inRollbackTx(db, async (tx) => {
      const sid = await shipment(tx);
      await tx.insert(wmsTables.waybills).values({ ...base(sid), status: 'failed', trackingNo: null });
      expect(await repo.findActiveByShipment(tx, sid)).toBeUndefined();
      await tx.insert(wmsTables.waybills).values({
        ...base(sid),
        status: 'registered',
        trackingNo: `T-${randomUUID().slice(0, 8)}`,
      });
      expect((await repo.findActiveByShipment(tx, sid))?.status).toBe('registered');
    });
  });
});
