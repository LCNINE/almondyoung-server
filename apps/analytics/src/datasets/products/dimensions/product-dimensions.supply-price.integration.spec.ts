import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { analyticsSchema, dimProductMasters } from '../../../schema';
import { ProductDimensionsService } from './product-dimensions.service';

/**
 * dim 원가 갱신 의미론: supplyPrice 키 부재(구버전 이벤트·미게시)는 기존 값을 유지하고,
 * null 은 "원가 지움"으로 반영해야 한다 — 스테일 원가로 마진이 계산되는 사고 방지.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="product-dimensions.supply-price.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ProductDimensionsService supplyPrice (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const masterId = `itest-master-${randomUUID().slice(0, 8)}`;

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let service: ProductDimensionsService;

  const basePayload = {
    masterId,
    name: '원가 시맨틱 테스트',
    previousActiveVersionId: null,
    changeReason: 'published' as const,
    changedAt: new Date().toISOString(),
  };

  const readSupplyPrice = async () => {
    const rows = await db
      .select({ supplyPrice: dimProductMasters.supplyPrice })
      .from(dimProductMasters)
      .where(eq(dimProductMasters.masterId, masterId));
    return rows[0]?.supplyPrice;
  };

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: analyticsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : (db.transaction((t) => fn(t)) as Promise<T>),
    } as unknown as DbService<typeof analyticsSchema>;
    service = new ProductDimensionsService(dbService);
  });

  afterAll(async () => {
    await db?.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterId));
    await sql?.end();
  });

  it('게시 이벤트의 supplyPrice 를 저장한다', async () => {
    await service.recordMasterActiveVersionChanged({ ...basePayload, versionId: `${masterId}-v1`, supplyPrice: 3000 });
    expect(await readSupplyPrice()).toBe(3000);
  });

  it('키가 없는 이벤트(구버전·미게시)는 기존 원가를 유지한다', async () => {
    await service.recordMasterActiveVersionChanged({ ...basePayload, versionId: null, changeReason: 'unpublished' });
    expect(await readSupplyPrice()).toBe(3000);
  });

  it('null 은 "원가 지움"으로 반영한다', async () => {
    await service.recordMasterActiveVersionChanged({ ...basePayload, versionId: `${masterId}-v2`, supplyPrice: null });
    expect(await readSupplyPrice()).toBeNull();
  });
});
