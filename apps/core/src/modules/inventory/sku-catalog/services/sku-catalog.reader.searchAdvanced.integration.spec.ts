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
    it('q 는 SKU 이름 부분일치와 SKU 코드 정확일치를 OR 로 찾는다', async () => {
      await inRollbackTx(async (tx) => {
        const token = randomUUID().slice(0, 8);
        const [byName, byCode] = await seedSkus(tx, token, 2);
        const [codeSku] = await tx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, byCode));

        const nameResult = await reader.searchAdvanced({ q: `IT-${token.toUpperCase()}`, limit: 20 }, tx);
        const codeResult = await reader.searchAdvanced({ q: ` ${codeSku.code} `, limit: 20 }, tx);
        const codePrefix = await reader.searchAdvanced({ q: codeSku.code.slice(0, -1), limit: 20 }, tx);

        expect(nameResult.items.map((item) => item.id).sort()).toEqual([byName, byCode].sort());
        expect(nameResult.total).toBe(2);
        expect(codeResult.items.map((item) => item.id)).toEqual([byCode]);
        expect(codeResult.q).toBe(codeSku.code);
        expect(codePrefix.items).toEqual([]);
        expect(codePrefix.total).toBe(0);
      });
    });

    it('q 는 기본·보조 바코드를 정확히 찾고 여러 경로가 맞아도 SKU 를 한 번만 센다', async () => {
      await inRollbackTx(async (tx) => {
        const token = randomUUID().slice(0, 8);
        const [primarySku, secondarySku] = await seedSkus(tx, token, 2);
        const primaryBarcode = `P-${randomUUID()}`;
        const secondaryBarcode = `S-${randomUUID()}`;

        await tx.insert(wmsTables.skuBarcodes).values([
          { skuId: primarySku, barcode: primaryBarcode, isPrimary: true },
          { skuId: secondarySku, barcode: secondaryBarcode, isPrimary: false },
        ]);

        const primary = await reader.searchAdvanced({ q: primaryBarcode }, tx);
        const secondary = await reader.searchAdvanced({ q: secondaryBarcode }, tx);
        const partial = await reader.searchAdvanced({ q: secondaryBarcode.slice(0, -1) }, tx);

        expect(primary.items.map((item) => item.id)).toEqual([primarySku]);
        expect(secondary.items.map((item) => item.id)).toEqual([secondarySku]);
        expect(partial.items).toEqual([]);
        expect(partial.total).toBe(0);

        await tx
          .update(wmsTables.skus)
          .set({ name: `it-${primaryBarcode}`, code: primaryBarcode })
          .where(eq(wmsTables.skus.id, primarySku));

        const duplicate = await reader.searchAdvanced({ q: primaryBarcode }, tx);

        expect(duplicate.items.map((item) => item.id)).toEqual([primarySku]);
        expect(duplicate.total).toBe(1);
      });
    });

    it('q 결과와 기존 필터를 AND 로 묶고 공백 q 는 적용하지 않는다', async () => {
      await inRollbackTx(async (tx) => {
        const token = randomUUID().slice(0, 8);
        const [a, b] = await seedSkus(tx, token, 2);
        const barcode = `it-${randomUUID()}`;
        await tx.insert(wmsTables.skuBarcodes).values({ skuId: a, barcode });

        const matched = await reader.searchAdvanced({ q: barcode, name: `it-${token}`, limit: 20 }, tx);
        const excluded = await reader.searchAdvanced({ q: barcode, code: 'different-code', limit: 20 }, tx);
        const empty = await reader.searchAdvanced({ q: '   ', name: `it-${token}`, limit: 20 }, tx);

        expect(matched.items.map((item) => item.id)).toEqual([a]);
        expect(matched.total).toBe(1);
        expect(excluded.items).toEqual([]);
        expect(excluded.total).toBe(0);
        expect(empty.items.map((item) => item.id).sort()).toEqual([a, b].sort());
        expect(empty.q).toBe('');
      });
    });

    it.each(['%', '_', '\\'])('q 의 %s 는 SKU 이름에서 와일드카드가 아닌 문자로 찾는다', async (special) => {
      await inRollbackTx(async (tx) => {
        const token = randomUUID().slice(0, 8);
        const [literal, other] = await seedSkus(tx, token, 2);
        await tx
          .update(wmsTables.skus)
          .set({ name: `it-${token}${special}` })
          .where(eq(wmsTables.skus.id, literal));
        await tx
          .update(wmsTables.skus)
          .set({ name: `it-${token}x` })
          .where(eq(wmsTables.skus.id, other));

        const result = await reader.searchAdvanced({ q: `it-${token}${special}`, limit: 20 }, tx);

        expect(result.items.map((item) => item.id)).toEqual([literal]);
        expect(result.total).toBe(1);
      });
    });

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
  it('검색 결과마다 SKU 사진 파일 id 를 대표 사진부터 싣는다', async () => {
    await inRollbackTx(async (tx) => {
      const token = randomUUID().slice(0, 8);
      const [withImages, without] = await seedSkus(tx, token, 2);
      const main = randomUUID();
      const extra = randomUUID();
      await tx.insert(wmsTables.skuImages).values([
        { skuId: withImages, uploadId: extra, isPrimary: false, sortOrder: 1 },
        { skuId: withImages, uploadId: main, isPrimary: true, sortOrder: 2 },
      ]);

      const result = await reader.searchAdvanced({ search: `it-${token}`, limit: 20, offset: 0 }, tx);
      const detail = await reader.getById(withImages, tx);
      const byId = new Map(result.items.map((item) => [item.id, item.imageFileIds]));

      expect(byId.get(withImages)).toEqual([main, extra]);
      expect(byId.get(without)).toEqual([]);
      expect(detail.imageFileIds).toEqual([main, extra]);
    });
  });
});
