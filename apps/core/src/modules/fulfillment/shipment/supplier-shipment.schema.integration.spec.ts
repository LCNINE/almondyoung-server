import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../services/__support__';
import {
  seedBox,
  seedDirectSupplier,
  seedFo,
  seedOrder,
  seedWorld,
} from '../order-progress/__support__/order-progress.fixtures';

/**
 * K3 PR 2 — 입점사 상자 expand 의 DB 제약(스펙 §4.1·§4.4). 실행:
 * DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<scratch> npx jest --runInBand --runTestsByPath <이 파일>
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('입점사 상자 스키마 제약 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  /** 저장점 안에서 위반을 일으키고 원인 사슬에 제약 이름이 있는지 본다 — 바깥 트랜잭션은 살아 있다. */
  async function expectViolation(tx: DbTx, constraint: string, action: (sp: DbTx) => Promise<unknown>) {
    let caught: unknown;
    try {
      await tx.transaction((sp) => action(sp as unknown as DbTx));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const evidence: string[] = [];
    let current = caught as (Error & { cause?: unknown; constraint_name?: string; code?: string }) | undefined;
    for (let depth = 0; current && depth < 5; depth += 1) {
      evidence.push(current.message, current.constraint_name ?? '', current.code ?? '');
      current = current.cause as typeof current;
    }
    expect(evidence.join(' ')).toContain(constraint);
  }

  async function seedSupplierBox(tx: DbTx) {
    const w = await seedWorld(tx);
    const order = await seedOrder(tx);
    const { foId, foItemId } = await seedFo(tx, w, order);
    const supplierId = await seedDirectSupplier(tx);
    const box = await seedBox(tx, w, [foItemId], { status: 'draft', supplierId });
    return { w, order, foId, foItemId, supplierId, ...box };
  }

  async function seedHandoff(tx: DbTx, supplierId: string): Promise<string> {
    const [row] = await tx.insert(wmsTables.supplierHandoffs).values({ supplierId, createdBy: 'it' }).returning();
    return row.id;
  }

  it('창고 상자와 입점사 상자는 들어간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const supplierId = await seedDirectSupplier(tx);
      const [warehouseBox] = await tx.insert(wmsTables.shipments).values({ warehouseId: w.warehouseId }).returning();
      const [supplierBox] = await tx.insert(wmsTables.shipments).values({ supplierId }).returning();
      expect(warehouseBox).toMatchObject({ warehouseId: w.warehouseId, supplierId: null });
      expect(supplierBox).toMatchObject({ warehouseId: null, supplierId });
    });
  });

  it('둘 다 없거나 둘 다 있으면 ck_shipments_owner', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const supplierId = await seedDirectSupplier(tx);
      await expectViolation(tx, 'ck_shipments_owner', (sp) => sp.insert(wmsTables.shipments).values({}));
      await expectViolation(tx, 'ck_shipments_owner', (sp) =>
        sp.insert(wmsTables.shipments).values({ warehouseId: w.warehouseId, supplierId }),
      );
    });
  });

  it('넘김 묶음은 같은 입점사 상자만', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await seedDirectSupplier(tx);
      const b = await seedDirectSupplier(tx);
      const handoffA = await seedHandoff(tx, a);
      const w = await seedWorld(tx);
      const [ok] = await tx
        .insert(wmsTables.shipments)
        .values({ supplierId: a, supplierHandoffId: handoffA })
        .returning();
      expect(ok.supplierHandoffId).toBe(handoffA);
      await expectViolation(tx, 'fk_shipments_supplier_handoff', (sp) =>
        sp.insert(wmsTables.shipments).values({ supplierId: b, supplierHandoffId: handoffA }),
      );
      await expectViolation(tx, 'ck_shipments_handoff_supplier', (sp) =>
        sp.insert(wmsTables.shipments).values({ warehouseId: w.warehouseId, supplierHandoffId: handoffA }),
      );
    });
  });

  it('못 보냄 칸은 셋이 함께', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedSupplierBox(tx);
      const lineId = f.lineIds[0];
      const setLine = (sp: DbTx, values: Partial<typeof wmsTables.shipmentLines.$inferInsert>) =>
        sp.update(wmsTables.shipmentLines).set(values).where(eq(wmsTables.shipmentLines.id, lineId));
      await expectViolation(tx, 'ck_shipment_lines_unfulfillable', (sp) =>
        setLine(sp, { unfulfillableReason: '품절' }),
      );
      // 사유 없이 시각·보고자만 — btrim(NULL) 이 NULL 이라 CHECK 가 통과시키면 안 된다
      await expectViolation(tx, 'ck_shipment_lines_unfulfillable', (sp) =>
        setLine(sp, { unfulfillableReportedAt: new Date(), unfulfillableReportedBy: 'it' }),
      );
      await expectViolation(tx, 'ck_shipment_lines_unfulfillable', (sp) =>
        setLine(sp, { unfulfillableReason: '   ', unfulfillableReportedAt: new Date(), unfulfillableReportedBy: 'it' }),
      );
      const [row] = await setLine(tx, {
        unfulfillableReason: '품절',
        unfulfillableReportedAt: new Date(),
        unfulfillableReportedBy: 'it',
      }).returning();
      expect(row.unfulfillableReason).toBe('품절');
    });
  });

  it('입점사 시도는 원장 없이 dispatched·recalled', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedSupplierBox(tx);
      const dispatchedAt = new Date('2026-10-25T00:00:00Z');
      const [attempt] = await tx
        .insert(wmsTables.dispatchAttempts)
        .values({
          shipmentId: f.shipmentId,
          attemptNo: 1,
          idempotencyKey: `it-${randomUUID()}`,
          kind: 'supplier',
          status: 'dispatched',
          dispatchedAt,
        })
        .returning();
      expect(attempt.kind).toBe('supplier');
      const [recalled] = await tx
        .update(wmsTables.dispatchAttempts)
        .set({ status: 'recalled', recalledAt: new Date('2026-10-25T01:00:00Z') })
        .where(eq(wmsTables.dispatchAttempts.id, attempt.id))
        .returning();
      expect(recalled.status).toBe('recalled');
    });
  });

  it('창고 시도는 여전히 원장이 필요하다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const [box] = await tx.insert(wmsTables.shipments).values({ warehouseId: w.warehouseId }).returning();
      await expectViolation(tx, 'ck_dispatch_attempts_dispatched_at', (sp) =>
        sp.insert(wmsTables.dispatchAttempts).values({
          shipmentId: box.id,
          attemptNo: 1,
          idempotencyKey: `it-${randomUUID()}`,
          status: 'dispatched',
          dispatchedAt: new Date(),
        }),
      );
    });
  });

  it('입점사 시도에 원장이 붙으면 거절', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedSupplierBox(tx);
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({ sourceType: 'it', idempotencyKey: `it-${randomUUID()}` })
        .returning();
      await expectViolation(tx, 'ck_dispatch_attempts_supplier_no_journal', (sp) =>
        sp.insert(wmsTables.dispatchAttempts).values({
          shipmentId: f.shipmentId,
          attemptNo: 1,
          idempotencyKey: `it-${randomUUID()}`,
          kind: 'supplier',
          stockJournalId: journal.id,
        }),
      );
    });
  });

  it('알릴 취소는 holder 나 supplier 중 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedSupplierBox(tx);
      const base = {
        orderCancellationId: randomUUID(),
        salesOrderId: f.order.salesOrderId,
        fulfillmentOrderId: f.foId,
        fulfillmentOrderItemId: f.foItemId,
        skuId: f.w.skuId,
        canceledQty: 1,
        cancellationScope: 'full' as const,
      };
      await expectViolation(tx, 'ck_direct_ship_cancel_notices_party', (sp) =>
        sp.insert(wmsTables.directShipCancelNotices).values({ ...base }),
      );
      await expectViolation(tx, 'ck_direct_ship_cancel_notices_party', (sp) =>
        sp
          .insert(wmsTables.directShipCancelNotices)
          .values({ ...base, holderId: f.w.holderId, supplierId: f.supplierId }),
      );
      const [row] = await tx
        .insert(wmsTables.directShipCancelNotices)
        .values({ ...base, supplierId: f.supplierId })
        .returning();
      expect(row).toMatchObject({ supplierId: f.supplierId, holderId: null });
    });
  });
});
