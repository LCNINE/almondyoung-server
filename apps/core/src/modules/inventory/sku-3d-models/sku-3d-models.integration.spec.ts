jest.mock('../../catalog/core/products/services/product-audit-log', () => ({
  recordProductAudit: async () => undefined,
}));

import { NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ProductCategoriesService } from '../../catalog/core/categories/categories.service';
import { ProductMastersService } from '../../catalog/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../catalog/core/products/services/product-versions.service';
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
  let lifecycle: ProductVersionsService;
  let categories: ProductCategoriesService;
  let masters: ProductMastersService;
  let originalCategoryId: string;
  let newCategoryId: string;
  let afterAssembly: (() => Promise<void>) | undefined;
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
      CREATE TABLE product_masters (id uuid PRIMARY KEY, deleted_at timestamp);
      CREATE TABLE product_master_versions (id uuid PRIMARY KEY, master_id uuid, status text, deleted_at timestamp, updated_at timestamp, draft_owner_id uuid, version integer DEFAULT 1);
      CREATE TABLE product_variants (id uuid PRIMARY KEY, display_order integer, status text);
      CREATE TABLE product_master_variants (master_id uuid, version_id uuid, variant_id uuid);
      CREATE TABLE product_matchings (id uuid PRIMARY KEY, variant_id uuid);
      CREATE TABLE product_variant_sku_links (product_matching_id uuid, sku_id uuid);
      CREATE TABLE test_projection_events (sequence serial, file_id text, origin text, reason text, version_id uuid, category_ids jsonb);
    `);
    await client.unsafe(readFileSync('apps/core/drizzle/20261029005659_add-sku-3d-models.sql', 'utf8'));
    // 실제 deleteVersion RETURNING과 카테고리 SELECT가 쓰는 열을 migration snapshot에서 구성한다.
    const snapshot = JSON.parse(readFileSync('apps/core/drizzle/meta/20261029005659_snapshot.json', 'utf8'));

    for (const tableName of ['product_categories', 'product_master_categories']) {
      const columns = Object.values(snapshot.tables[`public.${tableName}`].columns) as Array<{
        name: string;
        type: string;
      }>;
      await client.unsafe(
        `CREATE TABLE "${tableName}" (${columns.map((column) => `"${column.name}" ${column.type}`).join(', ')})`,
      );
    }

    const existing = new Set(['id', 'master_id', 'status', 'deleted_at', 'updated_at', 'draft_owner_id', 'version']);
    const versionColumns = Object.values(snapshot.tables['public.product_master_versions'].columns) as Array<{
      name: string;
      type: string;
    }>;

    for (const column of versionColumns) {
      if (existing.has(column.name)) {
        continue;
      }

      const type = snapshot.enums[`public.${column.type}`] ? 'text' : column.type;
      await client.unsafe(`ALTER TABLE product_master_versions ADD COLUMN "${column.name}" ${type}`);
    }

    await client.unsafe(`
      ALTER TABLE product_categories ADD PRIMARY KEY (id);
      ALTER TABLE product_master_categories ADD FOREIGN KEY (master_id) REFERENCES product_masters(id);
      ALTER TABLE product_master_categories ADD FOREIGN KEY (category_id) REFERENCES product_categories(id);
      ALTER TABLE product_master_categories ADD FOREIGN KEY (version_id) REFERENCES product_master_versions(id);
      ALTER TABLE product_variant_sku_links ADD FOREIGN KEY (sku_id) REFERENCES skus(id);
    `);

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
      assembleActiveVersionSnapshot: async (master: string, version: string, tx: any) => {
        const relations = await tx.execute(sql`
          SELECT category_id AS id FROM product_master_categories WHERE master_id = ${master} AND version_id = ${version}
          ORDER BY category_id
        `);
        const categoryIds = relations.map((row: { id: string }) => row.id);
        const snapshot = {
          name: 'Product',
          model3dFileId: await loader.getFileId(tx, master, version),
          categories: relations,
        };

        const pause = afterAssembly;
        afterAssembly = undefined;
        await pause?.();

        return { snapshot, categoryIds, primaryCategoryId: categoryIds[0] ?? null };
      },
    };
    const publisher = {
      enqueue: async (event: any, tx: any) => {
        if (event.eventType === 'CategoryChanged') {
          return;
        }

        await tx.execute(sql`
          INSERT INTO test_projection_events (file_id, origin, reason, version_id, category_ids)
          VALUES (${event.payload.snapshot?.model3dFileId ?? null}, ${event.payload.origin ?? null},
            ${event.payload.changeReason ?? event.eventType}, ${event.payload.versionId ?? null},
            ${JSON.stringify(event.payload.categoryIds ?? [])}::jsonb)
        `);

        if (failPublication) {
          throw new Error('outbox failed');
        }
      },
    };
    manager = new Sku3dModelsManager(dbService as any, files as any, loader, assembler as any, publisher as any);
    lifecycle = new ProductVersionsService(
      dbService as any,
      publisher as any,
      { validateCalculatedPrices: async () => undefined } as any,
      {} as any,
      assembler as any,
      { cachePricesForVersion: async () => undefined } as any,
      {} as any,
      { recalculateAndPublishForVariants: async () => undefined } as any,
      {} as any,
    );
    categories = new ProductCategoriesService(dbService as any, assembler as any, publisher as any);
    masters = new ProductMastersService(
      dbService as any,
      publisher as any,
      lifecycle,
      {} as any,
      {} as any,
      {} as any,
      { recalculateAndPublishForVersion: async () => undefined } as any,
      null,
    );
    const readVersion = async (tx: any, condition: ReturnType<typeof sql>) => {
      const [version] = await tx.execute(sql`
        SELECT id, master_id AS "masterId", status, deleted_at AS "deletedAt" FROM product_master_versions WHERE ${condition}
      `);

      if (!version) {
        throw new NotFoundException('No active version');
      }

      return { ...version, name: 'Product', version: 1, productCode: 'existing-code', fulfillmentKind: 'physical' };
    };
    jest.spyOn(masters, 'getVersionById').mockImplementation((id, _options, tx) => readVersion(tx, sql`id = ${id}`));
    jest.spyOn(lifecycle, 'getVersionById').mockImplementation((id, tx) => readVersion(tx, sql`id = ${id}`));
    jest
      .spyOn(lifecycle, 'getActiveVersion')
      .mockImplementation((id, tx) => readVersion(tx, sql`master_id = ${id} AND status = 'active'`));

    for (const method of [
      '_validateVariantCodeUniqueness',
      'validateProductCodeUniqueness',
      '_reconcileMatchingsAfterPublish',
      '_reconcileAssetLinksAfterPublish',
      '_reconcileChannelListingsAfterPublish',
      '_validateDigitalAssetLinks',
      '_publishVariantChangeEvents',
    ]) {
      jest.spyOn(lifecycle as any, method).mockResolvedValue(undefined);
    }

    jest.spyOn(lifecycle as any, '_diffAgainstPreviousActive').mockResolvedValue({});
    jest.spyOn(lifecycle, 'getVersionVariants').mockResolvedValue([]);
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    failPublication = false;
    afterAssembly = undefined;
    await client.unsafe(`
      TRUNCATE sku_3d_models, skus, product_masters, product_master_versions, product_variants,
        product_master_variants, product_matchings, product_variant_sku_links, test_projection_events,
        product_categories, product_master_categories CASCADE;
    `);
    masterId = randomUUID();
    versionId = randomUUID();
    firstSkuId = randomUUID();
    secondSkuId = randomUUID();
    await client`INSERT INTO product_masters (id) VALUES (${masterId})`;
    await client`INSERT INTO product_master_versions (id, master_id, status) VALUES (${versionId}, ${masterId}, 'active')`;
    originalCategoryId = randomUUID();
    newCategoryId = randomUUID();
    await client`INSERT INTO product_categories (id, name, slug) VALUES
      (${originalCategoryId}, 'Original', 'original'), (${newCategoryId}, 'New', 'new')`;
    await client`INSERT INTO product_master_categories (id, master_id, version_id, category_id)
      VALUES (${randomUUID()}, ${masterId}, ${versionId}, ${originalCategoryId})`;

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
  function pauseAfterSnapshot() {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    afterAssembly = async () => {
      entered();
      await paused;
    };

    return { ready, release };
  }

  async function waitUntilBlockedOrFinished(operation: Promise<unknown>) {
    let finished = false;
    operation.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [locks] = await client`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%product_masters%'
      `;

      if (finished || locks.count > 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    throw new Error('Concurrent lifecycle operation neither blocked nor completed');
  }

  it('cannot re-expose a product when unpublish overlaps an assembled model refresh', async () => {
    const row = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);
    const pause = pauseAfterSnapshot();
    const review = manager.review(row.id, { status: 'approved' }, actorId);
    await pause.ready;

    const unpublish = lifecycle.unpublishMaster(masterId, actorId);

    try {
      await waitUntilBlockedOrFinished(unpublish);
    } finally {
      pause.release();
    }

    await Promise.all([review, unpublish]);

    const events = await client`SELECT reason FROM test_projection_events ORDER BY sequence`;
    expect(events.at(-1)?.reason).toBe('unpublished');
    const [version] = await client`SELECT status FROM product_master_versions WHERE id = ${versionId}`;
    expect(version.status).toBe('inactive');
  });

  it('refreshes a concurrent first publication after the pending model approval commits', async () => {
    await client`UPDATE product_master_versions SET status = 'draft' WHERE id = ${versionId}`;
    const file = randomUUID();
    const row = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: file }, actorId);
    const pause = pauseAfterSnapshot();
    const publish = lifecycle.publishVersion(versionId, actorId);
    await pause.ready;

    const review = manager.review(row.id, { status: 'approved' }, actorId);

    try {
      await waitUntilBlockedOrFinished(review);
    } finally {
      pause.release();
    }

    await Promise.all([publish, review]);

    const events = await client`SELECT file_id, version_id FROM test_projection_events ORDER BY sequence`;
    expect(events.at(-1)).toMatchObject({ file_id: file, version_id: versionId });
  });
  it('rechecks the active target after waiting for a replacement publication', async () => {
    const replacementId = randomUUID();
    await client`INSERT INTO product_master_versions (id, master_id, status)
      VALUES (${replacementId}, ${masterId}, 'draft')`;
    await client`INSERT INTO product_master_variants (master_id, version_id, variant_id)
      SELECT master_id, ${replacementId}, variant_id FROM product_master_variants WHERE version_id = ${versionId}`;
    const file = randomUUID();
    const row = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: file }, actorId);
    const pause = pauseAfterSnapshot();
    const publish = lifecycle.publishVersion(replacementId, actorId);
    await pause.ready;

    const review = manager.review(row.id, { status: 'approved' }, actorId);

    try {
      await waitUntilBlockedOrFinished(review);
    } finally {
      pause.release();
    }

    await Promise.all([publish, review]);

    const events = await client`SELECT file_id, version_id FROM test_projection_events ORDER BY sequence`;
    expect(events.at(-1)).toMatchObject({ file_id: file, version_id: replacementId });
  });

  it('does not refresh a soft-deleted master even when its version stays active', async () => {
    await client`UPDATE product_masters SET deleted_at = now() WHERE id = ${masterId}`;

    await manager.register(firstSkuId, { status: 'approved', glbFileId: randomUUID() }, actorId);

    expect(await client`SELECT * FROM test_projection_events`).toHaveLength(0);
  });
  async function changeCategory(operation: 'move' | 'add' | 'delete') {
    if (operation === 'delete') {
      return categories.deleteCategory(originalCategoryId);
    }

    if (operation === 'add') {
      return categories.addProductsToCategory([versionId], newCategoryId);
    }

    return categories.moveProductsToCategory([versionId], newCategoryId);
  }

  it.each(['move', 'add', 'delete'] as const)(
    'category %s cannot restore a concurrently revoked model',
    async (operation) => {
      const row = await manager.register(firstSkuId, { status: 'approved', glbFileId: randomUUID() }, actorId);
      const pause = pauseAfterSnapshot();
      const categoryChange = changeCategory(operation);
      await pause.ready;

      const review = manager.review(row.id, { status: 'needs_revision' }, actorId);

      try {
        await waitUntilBlockedOrFinished(review);
      } finally {
        pause.release();
      }

      await Promise.all([categoryChange, review]);

      const events = await client`SELECT file_id FROM test_projection_events ORDER BY sequence`;
      expect(events.at(-1)?.file_id).toBeNull();
    },
  );

  it.each(['move', 'add', 'delete'] as const)(
    'category %s cannot re-expose a concurrently unpublished product',
    async (operation) => {
      const pause = pauseAfterSnapshot();
      const categoryChange = changeCategory(operation);
      await pause.ready;

      const unpublish = lifecycle.unpublishMaster(masterId, actorId);

      try {
        await waitUntilBlockedOrFinished(unpublish);
      } finally {
        pause.release();
      }

      await Promise.all([categoryChange, unpublish]);

      const events = await client`SELECT reason FROM test_projection_events ORDER BY sequence`;
      expect(events.at(-1)?.reason).toBe('unpublished');
    },
  );

  it('a delayed model snapshot cannot restore a concurrently removed category', async () => {
    const row = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);
    const pause = pauseAfterSnapshot();
    const review = manager.review(row.id, { status: 'approved' }, actorId);
    await pause.ready;

    const deletion = categories.deleteCategory(originalCategoryId);

    try {
      await waitUntilBlockedOrFinished(deletion);
    } finally {
      pause.release();
    }

    await Promise.all([review, deletion]);

    const events = await client`SELECT category_ids FROM test_projection_events ORDER BY sequence`;
    expect(events.at(-1)?.category_ids).toEqual([]);
  });

  it('a model review cannot re-expose a concurrently deleted active version', async () => {
    const row = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);
    const pause = pauseAfterSnapshot();
    const review = manager.review(row.id, { status: 'approved' }, actorId);
    await pause.ready;

    const deletion = masters.deleteVersion(versionId, actorId);

    try {
      await waitUntilBlockedOrFinished(deletion);
    } finally {
      pause.release();
    }

    await Promise.all([review, deletion]);

    const events = await client`SELECT reason FROM test_projection_events ORDER BY sequence`;
    expect(events.at(-1)?.reason).toBe('ProductMasterDeleted');
  });

  it('allows publication SKU-link foreign keys while a review waits for the product lock', async () => {
    const replacementId = randomUUID();
    await client`INSERT INTO product_master_versions (id, master_id, status)
      VALUES (${replacementId}, ${masterId}, 'draft')`;
    const row = await manager.register(firstSkuId, { status: 'needs_revision', glbFileId: randomUUID() }, actorId);
    let reached!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest
      .spyOn(lifecycle as any, '_reconcileMatchingsAfterPublish')
      .mockImplementationOnce(async (_new, _old, tx: any) => {
        reached();
        await proceed;

        // 실제 공개 경로도 상품을 잠근 뒤 기존 실물 SKU에 새 매칭 링크를 INSERT한다.
        await tx.execute(sql`INSERT INTO product_variant_sku_links (product_matching_id, sku_id)
        VALUES (${randomUUID()}, ${firstSkuId})`);
      });

    const publish = lifecycle.publishVersion(replacementId, actorId);
    await ready;
    const review = manager.review(row.id, { status: 'approved' }, actorId);

    try {
      await waitUntilBlockedOrFinished(review);
    } finally {
      release();
    }

    const outcomes = await Promise.allSettled([publish, review]);
    const errors = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason.cause?.message ?? outcome.reason.message] : [],
    );
    expect(errors).toEqual([]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
  });
});
