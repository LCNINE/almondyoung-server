// product-import-job.manager → product-import.manager → product-masters.service 가
// '@packages/event-contracts' 를 bare specifier 로 import 한다. jest moduleNameMapper 는
// 서브패스만 매핑하므로 여기서도 가상 모킹이 필요하다 (선례: product-import-job-lease.integration.spec.ts).
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { catalogSchema, productImportSessions, productImportItems } from '../../../schema/catalog.schema';
import { isProductRecord } from './product-import-job.manager';
import { ProductRecord } from '../dto/import.types';

/**
 * payload jsonb 왕복을 **진짜 Postgres** 에 대고 본다.
 *
 * 목 하네스는 넣은 객체를 그대로 돌려주므로 Date 가 문자열이 되는 것을 볼 수 없다.
 * 이 계획은 판매기간을 ISO 문자열로 들고 다니는 결정을 그 사실 위에 세웠으므로,
 * 그 사실 자체를 여기서 고정한다.
 *
 * **격리**: 일회용 스키마 + search_path (선례: product-import-progress.integration.spec.ts:20-45)
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_PRODUCT_IMPORT_PAYLOAD_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the product import payload roundtrip suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('product import payload jsonb 왕복 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `pi_payload_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof catalogSchema>>;

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    await admin.unsafe(`CREATE TABLE product_import_sessions (LIKE public.product_import_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_items (LIKE public.product_import_items INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, { max: 2, prepare: false, connection: { search_path: schemaName } });
    db = drizzle(client, { schema: catalogSchema });
  });

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await admin?.end();
  });

  async function roundtrip(record: ProductRecord): Promise<unknown> {
    const [session] = await db
      .insert(productImportSessions)
      .values({ fileName: 'roundtrip.xlsx', totalRows: 1, status: 'completed' })
      .returning();
    const [item] = await db
      .insert(productImportItems)
      .values({ sessionId: session.id, rowNumber: 1, productKey: 'P1', status: 'pending', payload: record })
      .returning();
    const [read] = await db.select().from(productImportItems).where(eq(productImportItems.id, item.id));
    return read.payload;
  }

  function v3Record(): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A' },
      version: { name: '니트A', seoTitle: '겨울 니트', seoKeywords: ['니트', '겨울'], isWholesaleOnly: true },
      basePrice: 29000,
      membershipPrice: 26000,
      categoryIds: ['c-knit', 'c-event'],
      categoryNames: ['여성패션', '니트'],
      primaryCategoryId: 'c-knit',
      options: [],
      variantOverrides: [],
      errors: [],
      purchaseConstraint: { requiresMembership: true, lifetimeQuantityLimit: 2 },
      salesStartDate: '2026-07-31T15:00:00.000Z',
      salesEndDate: '2026-08-31T14:59:59.999Z',
    };
  }

  it('신규 필드가 값과 타입을 그대로 유지한다', async () => {
    const payload = await roundtrip(v3Record());
    expect(isProductRecord(payload)).toBe(true);

    const record = payload as ProductRecord;
    expect(record.categoryIds).toEqual(['c-knit', 'c-event']);
    expect(record.primaryCategoryId).toBe('c-knit');
    expect(record.purchaseConstraint).toEqual({ requiresMembership: true, lifetimeQuantityLimit: 2 });
    expect(record.version.seoKeywords).toEqual(['니트', '겨울']);
    expect(record.version.isWholesaleOnly).toBe(true);

    // 핵심: 문자열로 넣었으니 문자열로 온다 — manager 가 여기서 Date 로 되살린다.
    expect(typeof record.salesStartDate).toBe('string');
    expect(record.salesStartDate).toBe('2026-07-31T15:00:00.000Z');
    expect(Number.isNaN(new Date(record.salesStartDate as string).getTime())).toBe(false);
  });

  it('Date 를 넣으면 문자열로 돌아온다 — 이 계획이 문자열을 택한 이유', async () => {
    const record = v3Record();
    // 일부러 타입을 어겨 왕복 동작 자체를 고정한다.
    const withDate = { ...record, version: { ...record.version, salesStartDate: new Date('2026-08-01T00:00:00Z') } };
    const payload = (await roundtrip(withDate as ProductRecord)) as { version: Record<string, unknown> };
    expect(typeof payload.version.salesStartDate).toBe('string');
  });

  it('v2 형태 payload(신규 필드 없음)도 그대로 통과한다', async () => {
    const record = v3Record();
    delete record.purchaseConstraint;
    delete record.salesStartDate;
    delete record.salesEndDate;

    const payload = await roundtrip(record);
    expect(isProductRecord(payload)).toBe(true);
    expect((payload as ProductRecord).purchaseConstraint).toBeUndefined();
    expect((payload as ProductRecord).salesStartDate).toBeUndefined();
  });
});
