import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, inRollbackTx } from '../../inbound/services/__fixtures__/inbound-harness';
import { InboundShipmentSkuMatcherReader } from './inbound-shipment-sku-matcher.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InboundShipmentSkuMatcherReader (DB integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  function readerFor(trx: DbTx) {
    const dbService = {
      db: trx,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new InboundShipmentSkuMatcherReader(dbService);
  }

  async function seedSku(trx: DbTx, code?: string) {
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `m-holder-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await trx
      .insert(wmsTables.skus)
      .values({
        name: 'matcher-sku',
        code: code ?? `M-${randomUUID().toUpperCase()}`.slice(0, 40),
        holderId: holder.id,
      })
      .returning();
    return sku;
  }

  const num = () =>
    `9${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;

  it('matches a registered barcode', async () => {
    await inRollbackTx(db, async (trx) => {
      const sku = await seedSku(trx);
      const code = num();
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode: code });
      const result = await readerFor(trx).match([code], trx);
      expect(result.get(code)).toEqual({ kind: 'one', skuId: sku.id });
    });
  });

  it('falls back to sku code', async () => {
    await inRollbackTx(db, async (trx) => {
      const code = `CODE-${randomUUID().slice(0, 8)}`;
      const sku = await seedSku(trx, code);
      const result = await readerFor(trx).match([code], trx);
      expect(result.get(code)).toEqual({ kind: 'one', skuId: sku.id });
    });
  });

  it('formula-escaped barcode row matches the same SKU without ambiguity', async () => {
    await inRollbackTx(db, async (trx) => {
      const sku = await seedSku(trx);
      const code = num();
      await trx.insert(wmsTables.skuBarcodes).values([
        { skuId: sku.id, barcode: code },
        { skuId: sku.id, barcode: `="${code}"` },
      ]);
      const result = await readerFor(trx).match([code], trx);
      expect(result.get(code)).toEqual({ kind: 'one', skuId: sku.id });
    });
  });

  it('two SKUs are ambiguous', async () => {
    await inRollbackTx(db, async (trx) => {
      const code = `AMB-${randomUUID().slice(0, 8)}`;
      const a = await seedSku(trx);
      const b = await seedSku(trx, code);
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: a.id, barcode: code });
      const result = await readerFor(trx).match([code], trx);
      const hit = result.get(code);
      expect(hit?.kind).toBe('many');
      if (hit?.kind === 'many') expect([...hit.skuIds].sort()).toEqual([a.id, b.id].sort());
    });
  });

  it('box barcode is packing_unit', async () => {
    await inRollbackTx(db, async (trx) => {
      const sku = await seedSku(trx);
      const code = num();
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode: code, packingUnit: 12 });
      const result = await readerFor(trx).match([code], trx);
      expect(result.get(code)).toEqual({ kind: 'packing_unit', skuId: sku.id });
    });
  });

  it('unknown barcode is none', async () => {
    await inRollbackTx(db, async (trx) => {
      const code = num();
      const result = await readerFor(trx).match([code], trx);
      expect(result.get(code)).toEqual({ kind: 'none' });
    });
  });
});
