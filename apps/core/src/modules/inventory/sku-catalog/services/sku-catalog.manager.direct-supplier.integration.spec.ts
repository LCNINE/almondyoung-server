import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder } from '../../../fulfillment/services/__support__';
import { SkuCatalogReader } from './sku-catalog.reader';
import { SkuCatalogManager } from './sku-catalog.manager';
import { SkuDirectSupplierRequiredError, SkuSupplierNotFoundError } from '../sku-catalog.errors';

/**
 * 직배 SKU 는 직배 공급사 하나(K3 §4.2). 실행:
 * DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<scratch> npx jest --runInBand --runTestsByPath <이 파일>
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const MISSING_SUPPLIER = '99999999-9999-4999-8999-999999999999';

describeIfDb('SkuCatalogManager × 직배 공급사 하나 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function manager(trx: DbTx): SkuCatalogManager {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new SkuCatalogManager(dbService, new SkuCatalogReader(dbService));
  }

  async function seedSupplier(trx: DbTx, isDirectDelivery: boolean): Promise<string> {
    const [row] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${randomUUID().slice(0, 8)}`, isDirectDelivery })
      .returning();
    return row.id;
  }

  async function linksOf(trx: DbTx, skuId: string): Promise<string[]> {
    const rows = await trx
      .select({ supplierId: wmsTables.skuSuppliers.supplierId })
      .from(wmsTables.skuSuppliers)
      .where(eq(wmsTables.skuSuppliers.skuId, skuId));
    return rows.map((row) => row.supplierId).sort();
  }

  /** 라이브 옛 모양: 규칙 이전에 만든, 직배 연결 없는 drop_shipped SKU */
  async function seedLegacyDropSku(trx: DbTx, holderId: string): Promise<string> {
    const [row] = await trx
      .insert(wmsTables.skus)
      .values({ name: 'legacy-drop', code: `IT-LDROP-${randomUUID()}`, holderId, stockType: 'drop_shipped' })
      .returning();
    return row.id;
  }

  it('직배 SKU 를 직배 공급사 없이 만들면 SKU_DIRECT_SUPPLIER_REQUIRED', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      await expect(manager(trx).create({ name: 'd', holderId, stockType: 'drop_shipped' }, trx)).rejects.toBeInstanceOf(
        SkuDirectSupplierRequiredError,
      );
    });
  });

  it('직배 아닌 공급사만 주면 거부, 직배 하나 + 직배 아닌 것 하나는 통과', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const direct = await seedSupplier(trx, true);
      const plain = await seedSupplier(trx, false);
      await expect(
        manager(trx).create({ name: 'd', holderId, stockType: 'drop_shipped', supplierIds: [plain] }, trx),
      ).rejects.toBeInstanceOf(SkuDirectSupplierRequiredError);
      const sku = await manager(trx).create(
        { name: 'd', holderId, stockType: 'drop_shipped', supplierIds: [direct, plain] },
        trx,
      );
      expect(await linksOf(trx, sku.id)).toEqual([direct, plain].sort());
    });
  });

  it('직배 공급사 둘이면 거부', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const a = await seedSupplier(trx, true);
      const b = await seedSupplier(trx, true);
      await expect(
        manager(trx).create({ name: 'd', holderId, stockType: 'drop_shipped', supplierIds: [a, b] }, trx),
      ).rejects.toBeInstanceOf(SkuDirectSupplierRequiredError);
    });
  });

  it('모르는 공급사 id 는 400 SKU_SUPPLIER_NOT_FOUND', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const error = await manager(trx)
        .create({ name: 'd', holderId, stockType: 'drop_shipped', supplierIds: [MISSING_SUPPLIER] }, trx)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SkuSupplierNotFoundError);
      expect((error as SkuSupplierNotFoundError).getHttpStatus()).toBe(400);
    });
  });

  it('같은 공급사 id 두 번은 한 번으로 친다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const a = await seedSupplier(trx, true);
      const sku = await manager(trx).create(
        { name: 'd', holderId, stockType: 'drop_shipped', supplierIds: [a, a] },
        trx,
      );
      expect(await linksOf(trx, sku.id)).toEqual([a]);
    });
  });

  it('옛 직배 SKU(연결 없음)의 이름만 바꾸면 통과 — stockType 을 같이 보내도', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const skuId = await seedLegacyDropSku(trx, holderId);
      const sku = await manager(trx).update(skuId, { name: 'renamed', stockType: 'drop_shipped' }, trx);
      expect(sku.name).toBe('renamed');
    });
  });

  it('physical → drop_shipped 전환은 직배 공급사가 있어야 한다 — supplierIds 를 안 보내면 기존 연결로 판정', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const direct = await seedSupplier(trx, true);
      const [bare] = await trx
        .insert(wmsTables.skus)
        .values({ name: 'p', code: `IT-P-${randomUUID()}`, holderId, stockType: 'physical' })
        .returning();
      await expect(manager(trx).update(bare.id, { stockType: 'drop_shipped' }, trx)).rejects.toBeInstanceOf(
        SkuDirectSupplierRequiredError,
      );
      await trx.insert(wmsTables.skuSuppliers).values({ skuId: bare.id, supplierId: direct });
      const sku = await manager(trx).update(bare.id, { stockType: 'drop_shipped' }, trx);
      expect(sku.stockType).toBe('drop_shipped');
    });
  });

  it('supplierIds: [] 로 직배 연결을 지우면 거부', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const direct = await seedSupplier(trx, true);
      const sku = await manager(trx).create(
        { name: 'd', holderId, stockType: 'drop_shipped', supplierIds: [direct] },
        trx,
      );
      await expect(manager(trx).update(sku.id, { supplierIds: [] }, trx)).rejects.toBeInstanceOf(
        SkuDirectSupplierRequiredError,
      );
      expect(await linksOf(trx, sku.id)).toEqual([direct]);
    });
  });
});
