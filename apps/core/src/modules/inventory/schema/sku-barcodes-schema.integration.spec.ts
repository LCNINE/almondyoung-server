import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from './inventory.schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('sku_barcodes.packing_unit (PostgreSQL constraints, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  /** 바코드를 달 SKU 하나. holder 는 skus.holder_id 가 NOT NULL 이라 필요하다. */
  async function fixture(tx: DbTx) {
    const suffix = randomUUID();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `packing-unit-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'packing-unit-sku', code: `PACKING-UNIT-${suffix}`, holderId: holder.id })
      .returning();
    return { sku, suffix };
  }

  async function expectCheckViolation(tx: DbTx, action: (savepoint: DbTx) => Promise<unknown>) {
    let caught: unknown;
    try {
      await tx.transaction((savepoint) => action(savepoint as unknown as DbTx));
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
    expect(evidence.join(' ')).toContain('ck_sku_barcodes_packing_unit_positive');
  }

  it('양의 정수 포장단위를 받는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [row] = await tx
        .insert(wmsTables.skuBarcodes)
        .values({ skuId: f.sku.id, barcode: `PU-OK-${f.suffix}`, packingUnit: 20 })
        .returning();
      expect(row.packingUnit).toBe(20);
    });
  });

  it('포장단위 없는 바코드를 받는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [row] = await tx
        .insert(wmsTables.skuBarcodes)
        .values({ skuId: f.sku.id, barcode: `PU-NULL-${f.suffix}` })
        .returning();
      expect(row.packingUnit).toBeNull();
    });
  });

  it('0 을 거부한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectCheckViolation(tx, (sp) =>
        sp.insert(wmsTables.skuBarcodes).values({ skuId: f.sku.id, barcode: `PU-ZERO-${f.suffix}`, packingUnit: 0 }),
      );
    });
  });

  it('음수를 거부한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectCheckViolation(tx, (sp) =>
        sp.insert(wmsTables.skuBarcodes).values({ skuId: f.sku.id, barcode: `PU-NEG-${f.suffix}`, packingUnit: -5 }),
      );
    });
  });
});
