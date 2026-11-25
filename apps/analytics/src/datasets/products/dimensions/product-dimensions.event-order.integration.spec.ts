import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { analyticsSchema, dimProductMasters, dimProductVariants } from '../../../schema';
import { ProductDimensionsService } from './product-dimensions.service';

/**
 * 이벤트 순서 역전 가드(#722): 늦게 도착한 옛 이벤트가 최신 상태를 덮지 못하고,
 * 그 이벤트에만 있던 칸은 비어 있을 때 채운다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="product-dimensions.event-order.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const T1 = '2026-11-01T00:00:00.000Z';
const T2 = '2026-11-02T00:00:00.000Z';
const T3 = '2026-11-03T00:00:00.000Z';

describeIfDb('ProductDimensionsService 이벤트 순서 역전 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const suffix = randomUUID().slice(0, 8);
  const masterId = `itest-order-master-${suffix}`;
  const variantId = `itest-order-variant-${suffix}`;
  const deletedVariantId = `itest-order-variant-del-${suffix}`;
  const versionId = `${masterId}-v1`;

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let service: ProductDimensionsService;

  const readMaster = async () =>
    (await db.select().from(dimProductMasters).where(eq(dimProductMasters.masterId, masterId)))[0];
  const readVariant = async (id: string) =>
    (await db.select().from(dimProductVariants).where(eq(dimProductVariants.variantId, id)))[0];

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
    await db?.delete(dimProductVariants).where(eq(dimProductVariants.masterId, masterId));
    await db?.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterId));
    await sql?.end();
  });

  it('삭제 뒤에 도착한 옛 게시 이벤트는 master 를 되살리지 못한다', async () => {
    await service.recordMasterActiveVersionChanged({
      masterId,
      name: '순서 역전 테스트',
      versionId,
      previousActiveVersionId: null,
      changeReason: 'published',
      changedAt: T1,
      supplyPrice: 1000,
    });
    await service.recordMasterDeleted({ masterId, deletedAt: T3 });

    // T2 의 옛 게시 이벤트가 삭제(T3) 뒤에 도착한다
    await service.recordMasterActiveVersionChanged({
      masterId,
      name: '순서 역전 테스트',
      versionId: `${masterId}-v2`,
      previousActiveVersionId: versionId,
      changeReason: 'published',
      changedAt: T2,
      supplyPrice: 2000,
    });

    const row = await readMaster();
    expect(row.deletedAt?.toISOString()).toBe(T3);
    expect(row.isActive).toBe(false);
    expect(row.activeVersionId).toBe(versionId);
    expect(row.supplyPrice).toBe(1000);
    expect(row.lastEventAt?.toISOString()).toBe(T3);
  });

  it('수정 뒤에 도착한 옛 생성 이벤트는 최신 값을 덮지 않고 빈 칸만 채운다', async () => {
    await service.recordVariantUpdated({
      masterId,
      versionId,
      variantId,
      variantName: '새 이름',
      status: 'active',
      updatedAt: T2,
    });

    await service.recordVariantCreated({
      masterId,
      versionId,
      productName: '순서 역전 테스트',
      variantId,
      variantName: '옛 이름',
      isDefault: true,
      status: 'draft',
      inventoryManagement: true,
      preStockSellable: true,
      createdAt: T1,
    });

    const row = await readVariant(variantId);
    expect(row.variantName).toBe('새 이름');
    expect(row.status).toBe('active');
    expect(row.isDefault).toBe(true);
    expect(row.inventoryManagement).toBe(true);
    expect(row.preStockSellable).toBe(true);
    expect(row.lastEventAt?.toISOString()).toBe(T2);
  });

  it('삭제 뒤에 도착한 옛 수정 이벤트는 variant 를 되살리지 못한다', async () => {
    await service.recordVariantDeleted({ masterId, versionId, variantId: deletedVariantId, deletedAt: T3 });
    await service.recordVariantUpdated({
      masterId,
      versionId,
      variantId: deletedVariantId,
      variantName: '옛 이름',
      status: 'active',
      updatedAt: T2,
    });

    const row = await readVariant(deletedVariantId);
    expect(row.deletedAt?.toISOString()).toBe(T3);
    expect(row.status).toBe('archived');
    expect(row.variantName).toBe('옛 이름');
  });

  it('더 새 이벤트는 종전처럼 덮어쓴다', async () => {
    await service.recordVariantUpdated({
      masterId,
      versionId,
      variantId,
      variantName: '더 새 이름',
      status: 'archived',
      updatedAt: T3,
    });

    const row = await readVariant(variantId);
    expect(row.variantName).toBe('더 새 이름');
    expect(row.status).toBe('archived');
    expect(row.lastEventAt?.toISOString()).toBe(T3);
  });
});
