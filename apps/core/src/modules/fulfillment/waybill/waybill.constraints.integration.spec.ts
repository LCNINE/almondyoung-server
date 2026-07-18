import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';
import { makeDb, inRollbackTx, seedWarehouseWithZone } from '../services/__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('waybills constraints (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  async function seedShipment(tx: DbTx): Promise<string> {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const [s] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'planned' }).returning();
    return s.id;
  }

  // drizzle-orm 0.44.x wraps postgres errors in DrizzleQueryError, whose top-level
  // `.message` is only "Failed query: ...\nparams: ..." — the actual constraint detail
  // (e.g. constraint name) lives on `.cause`. jest's `toThrow(regex)` only inspects
  // `.message`, so it never matches. Same workaround as
  // apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts's
  // `expectViolation` — walk the `.cause` chain instead.
  async function expectConstraintViolation(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const evidence: string[] = [];
    let current = caught as (Error & { cause?: unknown }) | undefined;
    for (let depth = 0; current && depth < 5; depth += 1) {
      evidence.push(current.message ?? '');
      current = current.cause as typeof current;
    }
    expect(evidence.join(' ')).toMatch(pattern);
  }

  it('rejects a second ACTIVE waybill for the same shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const shipmentId = await seedShipment(tx);
      await tx.insert(wmsTables.waybills).values({
        shipmentId,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo: `T-${randomUUID().slice(0, 8)}`,
        manifestVersion: 1,
        recipientHash: 'a'.repeat(64),
      });
      await expectConstraintViolation(
        tx.insert(wmsTables.waybills).values({
          shipmentId,
          source: 'manual',
          carrier: 'HANJIN',
          status: 'registered',
          trackingNo: `T-${randomUUID().slice(0, 8)}`,
          manifestVersion: 1,
          recipientHash: 'a'.repeat(64),
        }),
        /uq_waybills_shipment_active/,
      );
    });
  });

  it('allows a new active waybill once the prior one is voided (slot released)', async () => {
    await inRollbackTx(db, async (tx) => {
      const shipmentId = await seedShipment(tx);
      const [first] = await tx
        .insert(wmsTables.waybills)
        .values({
          shipmentId,
          source: 'manual',
          carrier: 'HANJIN',
          status: 'voided',
          trackingNo: `T-${randomUUID().slice(0, 8)}`,
          manifestVersion: 1,
          recipientHash: 'a'.repeat(64),
        })
        .returning();
      // voided 는 슬롯 해제 → 새 active 삽입 성공
      await tx.insert(wmsTables.waybills).values({
        shipmentId,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo: `T-${randomUUID().slice(0, 8)}`,
        manifestVersion: 1,
        recipientHash: 'a'.repeat(64),
      });
      expect(first.status).toBe('voided');
    });
  });

  it('check: allocated/registered/used require trackingNo', async () => {
    await inRollbackTx(db, async (tx) => {
      const shipmentId = await seedShipment(tx);
      await expectConstraintViolation(
        tx.insert(wmsTables.waybills).values({
          shipmentId,
          source: 'carrier',
          carrier: 'HANJIN',
          status: 'registered',
          trackingNo: null,
          manifestVersion: 1,
          recipientHash: 'a'.repeat(64),
        }),
        /ck_waybills_tracking_present/,
      );
    });
  });
});
