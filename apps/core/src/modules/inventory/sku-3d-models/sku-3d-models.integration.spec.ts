import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ProductModel3dLoader } from '../../catalog/core/products/loaders/product-model3d.loader';
import { wmsSchema } from '../schema/inventory.schema';
import { Sku3dModelsManager } from './sku-3d-models.manager';

// 전용 컨테이너에 최소 연결 테이블과 실제 additive migration을 적용해 로컬 데이터와 격리한다.
describe('SKU 3D models PostgreSQL integration', () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let client: postgres.Sql;
  let manager: Sku3dModelsManager;
  let failPublication: boolean;
  const loader = new ProductModel3dLoader();
  const actorId = randomUUID();
  let masterId: string;
  let versionId: string;
  let firstSkuId: string;
  let secondSkuId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    client = postgres(container.getConnectionUri(), { max: 8 });

    await client.unsafe(`
      CREATE TABLE skus (id uuid PRIMARY KEY, is_deleted boolean NOT NULL DEFAULT false);
      CREATE TABLE product_masters (id uuid PRIMARY KEY);
      CREATE TABLE product_master_versions (id uuid PRIMARY KEY, master_id uuid, status text, deleted_at timestamp);
      CREATE TABLE product_variants (id uuid PRIMARY KEY, display_order integer, status text);
      CREATE TABLE product_master_variants (master_id uuid, version_id uuid, variant_id uuid);
      CREATE TABLE product_matchings (id uuid PRIMARY KEY, variant_id uuid);
      CREATE TABLE product_variant_sku_links (product_matching_id uuid, sku_id uuid);
      CREATE TABLE test_projection_events (sequence serial, file_id text, origin text);
    `);
    await client.unsafe(readFileSync('apps/core/drizzle/20261029005659_add-sku-3d-models.sql', 'utf8'));

    const db = drizzle(client, { schema: wmsSchema });
    const dbService = { db, run: (fn: any) => db.transaction(fn) };
    const files = {
      fetchMetadata: async () => ({
        status: 'active',
        isPublic: true,
        contextId: 'sku-3d-model',
        mimeType: 'model/gltf-binary',
      }),
    };
    const assembler = {
      assembleActiveVersionSnapshot: async (master: string, version: string, tx: any) => ({
        snapshot: { name: 'Product', model3dFileId: await loader.getFileId(tx, master, version) },
        categoryIds: [],
        primaryCategoryId: null,
      }),
    };
    const publisher = {
      enqueue: async (event: any, tx: any) => {
        const { sql } = await import('drizzle-orm');
        await tx.execute(sql`
          INSERT INTO test_projection_events (file_id, origin)
          VALUES (${event.payload.snapshot.model3dFileId ?? null}, ${event.payload.origin ?? null})
        `);

        if (failPublication) {
          throw new Error('outbox failed');
        }
      },
    };
    manager = new Sku3dModelsManager(dbService as any, files as any, loader, assembler as any, publisher as any);
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    failPublication = false;
    await client.unsafe(`
      TRUNCATE sku_3d_models, skus, product_masters, product_master_versions, product_variants,
        product_master_variants, product_matchings, product_variant_sku_links, test_projection_events CASCADE;
    `);
    masterId = randomUUID();
    versionId = randomUUID();
    firstSkuId = randomUUID();
    secondSkuId = randomUUID();
    await client`INSERT INTO product_masters VALUES (${masterId})`;
    await client`INSERT INTO product_master_versions VALUES (${versionId}, ${masterId}, 'active', null)`;

    for (const [order, skuId] of [firstSkuId, secondSkuId].entries()) {
      const variantId = randomUUID();
      const matchingId = randomUUID();
      await client`INSERT INTO skus VALUES (${skuId}, false)`;
      await client`INSERT INTO product_variants VALUES (${variantId}, ${order}, 'active')`;
      await client`INSERT INTO product_master_variants VALUES (${masterId}, ${versionId}, ${variantId})`;
      await client`INSERT INTO product_matchings VALUES (${matchingId}, ${variantId})`;
      await client`INSERT INTO product_variant_sku_links VALUES (${matchingId}, ${skuId})`;
    }
  });

  async function selection(version = versionId) {
    return loader.getFileId(drizzle(client) as any, masterId, version);
  }

  it('selects newest approved model of the first variant and falls back on revocation', async () => {
    const oldFile = randomUUID();
    const newFile = randomUUID();
    const otherFile = randomUUID();
    const old = await manager.register(firstSkuId, { status: 'approved', glbFileId: oldFile }, actorId);
    const newest = await manager.register(firstSkuId, { status: 'approved', glbFileId: newFile }, actorId);
    await manager.register(firstSkuId, { status: 'failed' }, actorId);
    await manager.register(secondSkuId, { status: 'approved', glbFileId: otherFile }, actorId);

    expect(await selection()).toBe(newFile);

    await manager.review(newest.id, { status: 'needs_revision' }, actorId);
    expect(await selection()).toBe(oldFile);

    await manager.review(old.id, { status: 'needs_more_photos' }, actorId);
    expect(await selection()).toBe(otherFile);

    await client`UPDATE skus SET is_deleted = true WHERE id = ${secondSkuId}`;
    expect(await selection()).toBeUndefined();
  });

  it('scopes selection to the requested product version and active variants', async () => {
    const file = randomUUID();
    await manager.register(firstSkuId, { status: 'approved', glbFileId: file }, actorId);

    expect(await selection(randomUUID())).toBeUndefined();

    await client`UPDATE product_variants SET status = 'inactive'`;
    expect(await selection()).toBeUndefined();
  });

  it('allocates distinct sequential versions under concurrent registration', async () => {
    const models = await Promise.all(
      Array.from({ length: 8 }, () => manager.register(firstSkuId, { status: 'failed' }, actorId)),
    );

    expect(models.map((model) => model.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await manager.list(firstSkuId)).toHaveLength(8);
  });

  it('serializes concurrent reviews of different SKUs on one product and emits the final selection', async () => {
    const firstFile = randomUUID();
    const first = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: firstFile }, actorId);
    const second = await manager.register(secondSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);

    await Promise.all([
      manager.review(second.id, { status: 'approved' }, actorId),
      manager.review(first.id, { status: 'approved' }, actorId),
    ]);

    const events = await client`SELECT file_id FROM test_projection_events ORDER BY sequence`;
    expect(await selection()).toBe(firstFile);
    expect(events.at(-1)?.file_id).toBe(firstFile);
    expect(events.length).toBeLessThanOrEqual(2);
  });

  it('rolls back model status and the inserted outbox row together', async () => {
    const row = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);
    failPublication = true;

    await expect(manager.review(row.id, { status: 'approved' }, actorId)).rejects.toThrow('outbox failed');

    const [model] = await client`SELECT status FROM sku_3d_models WHERE id = ${row.id}`;
    expect(model.status).toBe('needs_revision');
    expect(await client`SELECT * FROM test_projection_events`).toHaveLength(0);
  });

  it('publishes one bulk refresh per changed product and skips notes-only changes', async () => {
    const first = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);
    const second = await manager.register(secondSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);

    await manager.reviewBatch([first.id, second.id], { status: 'approved' }, actorId);
    await manager.review(first.id, { status: 'approved', notes: { dimensions: 'measured' } }, actorId);

    const events = await client`SELECT origin FROM test_projection_events`;
    expect(events).toEqual([{ origin: 'bulk_import' }]);
  });
});
