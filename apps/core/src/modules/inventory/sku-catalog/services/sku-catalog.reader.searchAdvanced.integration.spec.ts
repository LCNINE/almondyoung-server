import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { SkuCatalogReader } from './sku-catalog.reader';

/**
 * searchAdvanced 회귀 가드. sku-id 서브쿼리가 `selectDistinct(...) + GROUP BY skus.id +
 * ORDER BY <select 목록 밖 컬럼>` 이라, Postgres 가
 *   "for SELECT DISTINCT, ORDER BY expressions must appear in select list"
 * 로 거부한다 → 모든 검색이 500. GROUP BY(PK)가 이미 중복을 제거하므로 DISTINCT 는
 * 불필요했고, 빼면 함수 종속성으로 ORDER BY 가 유효해진다. (admin-web 은 이 엔드포인트를
 * 쓰지 않아, warehouse-app 이 첫 소비자가 되며 뒤늦게 드러난 잠재 버그.)
 *
 * 실행: npm run test:core:integration:local -- sku-catalog.reader.searchAdvanced.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('SkuCatalogReader.searchAdvanced (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let reader: SkuCatalogReader;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;
    reader = new SkuCatalogReader(dbService);
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

  /** 검색 토큰이 이름에 박힌 SKU n개를 심고 id 배열을 돌려준다. */
  async function seedSkus(tx: DbTx, token: string, n: number): Promise<string[]> {
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: `it-${token}-${i}`, code: `IT-${randomUUID()}`, holderId: holder.id })
        .returning();
      ids.push(sku.id);
    }
    return ids;
  }

  it('기본 정렬(createdAt)로 검색해도 오류 없이 매칭 SKU 를 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const token = randomUUID().slice(0, 8);
      const ids = await seedSkus(tx, token, 2);

      const result = await reader.searchAdvanced({ search: `it-${token}`, limit: 20, offset: 0 }, tx);

      expect(result.items.map((i) => i.id)).toEqual(expect.arrayContaining(ids));
      expect(result.total).toBeGreaterThanOrEqual(2);
    });
  });

  it('name 정렬로 검색해도 오류 없이 매칭 SKU 를 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const token = randomUUID().slice(0, 8);
      const ids = await seedSkus(tx, token, 2);

      const result = await reader.searchAdvanced(
        { search: `it-${token}`, limit: 20, offset: 0, sortBy: 'name', sortOrder: 'asc' },
        tx,
      );

      expect(result.items.map((i) => i.id)).toEqual(expect.arrayContaining(ids));
    });
  });

  // 2026-11-02: limit 을 받지 않던 search 와 상한 없는 목록이 core 를 OOM 으로 내렸다.
  // 이 파일은 searchAdvanced 회귀 가드로 시작했지만 SKU 목록 두 경로의 페이징을 함께 지킨다.
  describe('목록 페이징', () => {
    it('search 는 limit·offset 만큼만 돌려준다', async () => {
      await inRollbackTx(async (tx) => {
        const token = randomUUID().slice(0, 8);
        await seedSkus(tx, token, 3);

        const first = await reader.search({ name: `it-${token}`, limit: 2, offset: 0 }, tx);
        const rest = await reader.search({ name: `it-${token}`, limit: 2, offset: 2 }, tx);

        expect(first).toHaveLength(2);
        expect(rest).toHaveLength(1);
        expect(new Set([...first, ...rest].map((s) => s.id)).size).toBe(3);
      });
    });
  });

  describe('searchAdvanced 필터 (SKU 목록 화면이 쓰는 것)', () => {
    it('name 은 부분일치, code 는 정확일치로 거른다', async () => {
      await inRollbackTx(async (tx) => {
        const token = randomUUID().slice(0, 8);
        const [a, b] = await seedSkus(tx, token, 2);
        const [skuA] = await tx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, a));

        const byName = await reader.searchAdvanced({ name: `it-${token}`, limit: 20, offset: 0 }, tx);
        const byCode = await reader.searchAdvanced({ code: skuA.code, limit: 20, offset: 0 }, tx);
        const byCodePrefix = await reader.searchAdvanced({ code: skuA.code.slice(0, 6), limit: 20, offset: 0 }, tx);

        expect(byName.items.map((i) => i.id).sort()).toEqual([a, b].sort());
        expect(byName.total).toBe(2);
        expect(byCode.items.map((i) => i.id)).toEqual([a]);
        expect(byCodePrefix.items.map((i) => i.id)).not.toContain(a);
      });
    });

    it('barcode·supplierName 으로 거른다', async () => {
      await inRollbackTx(async (tx) => {
        const token = randomUUID().slice(0, 8);
        const [a, b] = await seedSkus(tx, token, 2);
        const barcode = `it-${randomUUID().slice(0, 12)}`;
        await tx.insert(wmsTables.skuBarcodes).values({ skuId: a, barcode });
        const [supplier] = await tx
          .insert(wmsTables.suppliers)
          .values({ name: `it-공급사-${token}` })
          .returning();
        await tx.insert(wmsTables.skuSuppliers).values({ skuId: b, supplierId: supplier.id });

        const byBarcode = await reader.searchAdvanced({ barcode, limit: 20, offset: 0 }, tx);
        const bySupplier = await reader.searchAdvanced({ supplierName: `공급사-${token}`, limit: 20, offset: 0 }, tx);

        expect(byBarcode.items.map((i) => i.id)).toEqual([a]);
        expect(byBarcode.total).toBe(1);
        expect(bySupplier.items.map((i) => i.id)).toEqual([b]);
        expect(bySupplier.total).toBe(1);
      });
    });
  });
});
