import { eq } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import {
  skuReferencePhotos,
  sku3dWorkshopEvents,
  sku3dWorkshopJobs,
  sku3dWorkshopRevisions,
  sku3dWorkshops,
} from '../schema/inventory.schema';
import { actor, finishedRevision, seedSku, startWorkshopDb, WorkshopTestDb } from './__support__/workshop-db';
import { Sku3dWorkshopManager } from './sku-3d-workshop.manager';
import { Sku3dWorkshopReader } from './sku-3d-workshop.reader';
import { FileServiceClient } from '../../library/clients/file-service.client';

const describeWithPostgres = process.env.REQUIRE_SKU_3D_WORKSHOP_DB === '1' ? describe : describe.skip;

describeWithPostgres('SKU 3D workshop (PostgreSQL)', () => {
  jest.setTimeout(180_000);

  let t: WorkshopTestDb;
  let manager: Sku3dWorkshopManager;
  let reader: Sku3dWorkshopReader;
  const fetchFile = jest.fn();
  const files = { fetchFile } as unknown as FileServiceClient;

  beforeAll(async () => {
    t = await startWorkshopDb();
    manager = new Sku3dWorkshopManager(t.dbService, { tenantId: () => 'tenant-a' });
    reader = new Sku3dWorkshopReader(t.dbService, files);
  });

  afterAll(async () => {
    await t.client.end();
    await t.container.stop();
  });

  it('open is idempotent', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const opened = await Promise.all([1, 2, 3].map(() => manager.open(skuId, me)));
    const rows = await t.db.select().from(sku3dWorkshops).where(eq(sku3dWorkshops.skuId, skuId));

    expect(rows).toHaveLength(1);
    expect(new Set(opened.map((w) => w.id)).size).toBe(1);
    expect(rows[0].tenantId).toBe('tenant-a');
  });

  it('separate workshop per owner', async () => {
    const skuId = await seedSku(t.db);
    const a = await manager.open(skuId, actor());
    const b = await manager.open(skuId, actor());

    expect(a.id).not.toBe(b.id);
  });

  it('open rejects unknown sku', async () => {
    await expect(manager.open('00000000-0000-0000-0000-00000000dead', actor())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('confirmDimensions twice creates one job', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const workshop = await manager.open(skuId, me);
    const jobs = await Promise.all([
      manager.confirmDimensions(workshop.id, me, 'package'),
      manager.confirmDimensions(workshop.id, me, 'package'),
    ]);
    const rows = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.workshopId, workshop.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'create', status: 'queued' });
    expect(jobs[0]?.id).toBe(jobs[1]?.id);
  });

  it('confirmDimensions after a revision only updates the basis', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const workshop = await manager.open(skuId, me);

    await manager.confirmDimensions(workshop.id, me, 'package');
    await finishedRevision(t.db, workshop.id);

    const job = await manager.confirmDimensions(workshop.id, me, 'body');
    const [row] = await t.db.select().from(sku3dWorkshops).where(eq(sku3dWorkshops.id, workshop.id));

    expect(job).toBeNull();
    expect(row.dimensionBasis).toBe('body');
  });

  it('rejects message while job active', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const workshop = await manager.open(skuId, me);

    await manager.confirmDimensions(workshop.id, me, 'package');

    await expect(manager.postMessage(workshop.id, me, '뚜껑을 둥글게 해줘')).rejects.toBeInstanceOf(ConflictError);

    const rows = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.workshopId, workshop.id));
    const events = await t.db.select().from(sku3dWorkshopEvents).where(eq(sku3dWorkshopEvents.workshopId, workshop.id));

    expect(rows).toHaveLength(1);
    expect(events.filter((e) => e.type === 'user_message')).toHaveLength(0);
  });

  it('message creates a revise job on the latest revision', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const workshop = await manager.open(skuId, me);

    await manager.confirmDimensions(workshop.id, me, 'package');

    const revisionId = await finishedRevision(t.db, workshop.id);
    const results = await Promise.allSettled([
      manager.postMessage(workshop.id, me, '좀 별론데 더 다듬어줘'),
      manager.postMessage(workshop.id, me, '뚜껑을 둥글게 해줘'),
    ]);
    const active = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.status, 'queued'));
    const mine = active.filter((j) => j.workshopId === workshop.id);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'revise', baseRevisionId: revisionId });
  });

  it('mine lists only my workshops with their status', async () => {
    const me = actor();
    const waiting = await manager.open(await seedSku(t.db), me);
    const making = await manager.open(await seedSku(t.db), me);
    const review = await manager.open(await seedSku(t.db), me);
    const failed = await manager.open(await seedSku(t.db), me);

    await manager.open(await seedSku(t.db), actor());
    await manager.confirmDimensions(making.id, me, 'package');
    await manager.confirmDimensions(review.id, me, 'package');
    await finishedRevision(t.db, review.id);
    await manager.confirmDimensions(failed.id, me, 'package');
    await t.db
      .update(sku3dWorkshopJobs)
      .set({ status: 'failed', error: '사진 부족' })
      .where(eq(sku3dWorkshopJobs.workshopId, failed.id));

    const list = await reader.mine(me);
    const statusOf = Object.fromEntries(list.map((w) => [w.id, w.status]));

    expect(list).toHaveLength(4);
    expect(statusOf).toEqual({
      [waiting.id]: 'waiting',
      [making.id]: 'making',
      [review.id]: 'review',
      [failed.id]: 'failed',
    });
    expect(list.find((w) => w.id === making.id)).toMatchObject({ activeJobKind: 'create', latestRevisionNumber: null });
    expect(list.find((w) => w.id === review.id)).toMatchObject({ activeJobKind: null, latestRevisionNumber: 1 });
    expect(list.find((w) => w.id === failed.id)?.failedError).toBe('사진 부족');

    await manager.postMessage(review.id, me, '뚜껑을 둥글게 해줘');

    expect((await reader.mine(me))[0]).toMatchObject({ id: review.id, status: 'making', activeJobKind: 'revise' });
  });

  it('hides other owner workshop', async () => {
    const skuId = await seedSku(t.db);
    const owner = actor();
    const workshop = await manager.open(skuId, owner);

    await expect(reader.detail(workshop.id, actor())).rejects.toBeInstanceOf(NotFoundError);
    await expect(reader.detail(workshop.id, actor({ canManage: true }))).resolves.toMatchObject({
      workshop: { id: workshop.id },
    });
    await expect(manager.confirmDimensions(workshop.id, actor({ canManage: true }), 'body')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('revision file is served only after the access check', async () => {
    const skuId = await seedSku(t.db);
    const owner = actor();
    const workshop = await manager.open(skuId, owner);

    await manager.confirmDimensions(workshop.id, owner, 'package');

    const revisionId = await finishedRevision(t.db, workshop.id);
    fetchFile.mockReset();
    fetchFile.mockResolvedValue({
      stream: new Response(new Uint8Array([1, 2, 3])).body!,
      contentType: 'model/gltf-binary',
      contentLength: 3,
    });

    await expect(reader.revisionFile(workshop.id, revisionId, 'glb', actor())).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchFile).not.toHaveBeenCalled();

    const file = await reader.revisionFile(workshop.id, revisionId, 'glb', owner);

    expect([...file.bytes]).toEqual([1, 2, 3]);
    expect(fetchFile).toHaveBeenCalledWith(expect.any(String), owner.userId);
  });

  it('detail reports material changes since the latest version', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const workshop = await manager.open(skuId, me);

    await manager.confirmDimensions(workshop.id, me, 'package');

    const revisionId = await finishedRevision(t.db, workshop.id);

    await t.db
      .update(sku3dWorkshopRevisions)
      .set({
        provenance: {
          inputs: {
            photos: [],
            sku: {
              packageWidthMm: 120,
              packageLengthMm: 45,
              packageHeightMm: 30,
              packageWeightG: 250,
              dimensionBasis: 'package',
            },
          },
        },
      })
      .where(eq(sku3dWorkshopRevisions.id, revisionId));

    expect((await reader.detail(workshop.id, me)).materialChanges).toBeNull();

    await t.db.insert(skuReferencePhotos).values({
      skuId,
      fileId: '00000000-0000-4000-8000-00000000f001',
      sortOrder: 1,
      takenById: me.userId,
      takenByLabel: me.label,
    });

    expect((await reader.detail(workshop.id, me)).materialChanges).toEqual({
      addedPhotos: ['00000000-0000-4000-8000-00000000f001'],
      removedPhotos: [],
      dimensions: null,
    });
  });

  it('events after cursor', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const workshop = await manager.open(skuId, me);
    const inserted = await t.db
      .insert(sku3dWorkshopEvents)
      .values([1, 2, 3, 4, 5].map((n) => ({ workshopId: workshop.id, type: 'progress' as const, body: `p${n}` })))
      .returning();
    const cursor = inserted[1].seq;
    const { events } = await reader.events(workshop.id, me, cursor);

    expect(events.map((e) => e.body)).toEqual(['p3', 'p4', 'p5']);
  });

  it('detail reports worker offline when none seen recently', async () => {
    const skuId = await seedSku(t.db);
    const me = actor();
    const workshop = await manager.open(skuId, me);
    const detail = await reader.detail(workshop.id, me);

    expect(detail.worker.online).toBe(false);
    expect(detail.sku).toMatchObject({ packageWidthMm: 120, packageHeightMm: 30 });
  });
});
