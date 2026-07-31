import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { catalogSchema, type PimSchema } from '../../../schema/catalog.schema';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportProgressBuilder } from './product-import-progress.builder';
import { indexSessionImages } from './product-import-image.resolver';
import type { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';

/**
 * 이미지 레인(v3 4단계)을 **진짜 Postgres** 에 대고 구동한다.
 *
 * 목 하네스는 `.groupBy()` 를 삼켜도 같은 배열을 돌려주고, UNIQUE 제약이나 컬럼
 * DEFAULT 는 아예 보이지 않는다. 여기서는 실제 SQL 이 실제 행에 어떻게 작용하는지만 본다.
 *
 * **격리**: 일회용 스키마 + `CREATE TABLE (LIKE public.x INCLUDING ALL)` + search_path
 * (선례: product-import-progress.integration.spec.ts, product-import-job-lease.integration.spec.ts).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_PRODUCT_IMPORT_IMAGE_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the product import image lane integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('product import 이미지 레인 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `pi_images_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let reader: ProductImportSessionReader;
  const builder = new ProductImportProgressBuilder();

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    // public 의 실제 DDL 을 복제한다 — 손으로 옮겨 적은 테이블에 대고 통과하는 테스트는
    // 아무 것도 증명하지 못한다. INCLUDING ALL 이 DEFAULT·UNIQUE·인덱스를 함께 가져온다.
    await admin.unsafe(`CREATE TABLE product_import_sessions (LIKE public.product_import_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_items (LIKE public.product_import_items INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_images (LIKE public.product_import_images INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    const db = drizzle(client, { schema: catalogSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as never)),
    } as unknown as DbService<PimSchema>;
    reader = new ProductImportSessionReader(dbService, undefined as unknown as OptionReadLoader);
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([client?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM product_import_images`;
    await admin`DELETE FROM product_import_sessions`;
  });

  async function seedSession(over: { imageStatus?: string; commitStatus?: string } = {}): Promise<string> {
    const id = randomUUID();
    // image_status 를 **일부러 명시하지 않는 경로**가 아래 첫 테스트다. 여기서는 필요할 때만 준다.
    if (over.imageStatus) {
      await admin`
        INSERT INTO product_import_sessions (id, file_name, total_rows, status, commit_status, publish_status, image_status)
        VALUES (${id}, ${'it-img-' + id}, 1, 'completed', ${over.commitStatus ?? 'idle'}, 'idle', ${over.imageStatus})
      `;
    } else {
      await admin`
        INSERT INTO product_import_sessions (id, file_name, total_rows, status, commit_status, publish_status)
        VALUES (${id}, ${'it-img-' + id}, 1, 'completed', ${over.commitStatus ?? 'completed'}, 'idle')
      `;
    }
    return id;
  }

  it('image_status 를 명시하지 않은 세션은 completed 로 앉는다 (옛 세션이 레인에 갇히지 않는다)', async () => {
    const id = await seedSession();
    const [row] = await admin`SELECT image_status FROM product_import_sessions WHERE id = ${id}`;
    expect(row.image_status).toBe('completed');
  });

  it('같은 (session, imageKey, usage) 는 두 번 들어가지 않는다', async () => {
    const id = await seedSession({ imageStatus: 'queued' });
    await admin`
      INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
      VALUES (${randomUUID()}, ${id}, 'IMG-1', 'main', 'https://e.example/1.jpg', 'pending')
    `;
    await expect(
      admin`
        INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
        VALUES (${randomUUID()}, ${id}, 'IMG-1', 'main', 'https://e.example/other.jpg', 'pending')
      `,
    ).rejects.toThrow();
  });

  it('용도가 다르면 같은 키라도 행이 둘이다', async () => {
    const id = await seedSession({ imageStatus: 'queued' });
    for (const usage of ['main', 'description']) {
      await admin`
        INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
        VALUES (${randomUUID()}, ${id}, 'IMG-1', ${usage}, 'https://e.example/1.jpg', 'pending')
      `;
    }
    const rows = await reader.getSessionImages(id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.usage).sort()).toEqual(['description', 'main']);
  });

  it('getSessionImages → indexSessionImages 가 uploaded 만 fileId 맵에 넣는다', async () => {
    const id = await seedSession({ imageStatus: 'running' });
    const fileId = randomUUID();
    await admin`
      INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status, file_id)
      VALUES (${randomUUID()}, ${id}, 'IMG-1', 'main', 'https://e.example/1.jpg', 'uploaded', ${fileId})
    `;
    await admin`
      INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status, error_message)
      VALUES (${randomUUID()}, ${id}, 'IMG-2', 'main', 'https://e.example/2.jpg', 'fetch_failed', '404')
    `;
    const index = indexSessionImages(await reader.getSessionImages(id));
    expect(index.fileIds.main.get('IMG-1')).toBe(fileId);
    expect(index.failures.get('main:IMG-2')).toBe('404');
  });

  it('진행률 이미지 집계가 실제 GROUP BY 로 나온다 (count 가 bigint 문자열로 와도)', async () => {
    const id = await seedSession({ imageStatus: 'running', commitStatus: 'idle' });
    const rows: Array<[string, string]> = [
      ['IMG-1', 'pending'],
      ['IMG-2', 'probed'],
      ['IMG-3', 'probe_failed'],
      ['IMG-4', 'uploaded'],
      ['IMG-5', 'fetch_failed'],
    ];
    for (const [key, status] of rows) {
      await admin`
        INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
        VALUES (${randomUUID()}, ${id}, ${key}, 'main', 'https://e.example/x.jpg', ${status})
      `;
    }
    const { session, itemCounts, imageCounts } = await reader.getProgressCounts(id);
    expect(imageCounts.every((c) => typeof c.count === 'number')).toBe(true);

    const progress = builder.build(session, itemCounts, imageCounts);
    const probe = progress.stages.find((s) => s.key === 'probe')!;
    const fetch = progress.stages.find((s) => s.key === 'fetch')!;
    expect(probe).toMatchObject({ total: 5, done: 4, failed: 1, status: 'running' });
    // fetch 분모에서 probe_failed 1건이 빠진다
    expect(fetch).toMatchObject({ total: 3, done: 2, failed: 1 });
  });

  it('취소된 세션은 이미지 레인 클레임에 잡히지 않는다', async () => {
    const id = await seedSession({ imageStatus: 'queued' });
    await admin`UPDATE product_import_sessions SET cancel_requested_at = NOW(), image_status = 'canceled' WHERE id = ${id}`;
    // ⚠️ 아래 WHERE 절은 product-import-job.manager.ts 의 claim() 서브쿼리 WHERE 절과
    // 바이트 단위로 대조를 마쳤다(컬럼명 image_status 로 치환한 것 외 동일):
    // `${statusColumn} IN ('queued', 'running') AND (lease_until IS NULL OR lease_until < NOW())
    //   AND cancel_requested_at IS NULL` (product-import-job.manager.ts:178-180).
    const [row] = await admin`
      SELECT id FROM product_import_sessions
       WHERE image_status IN ('queued', 'running')
         AND (lease_until IS NULL OR lease_until < NOW())
         AND cancel_requested_at IS NULL
    `;
    expect(row).toBeUndefined();
  });
});
