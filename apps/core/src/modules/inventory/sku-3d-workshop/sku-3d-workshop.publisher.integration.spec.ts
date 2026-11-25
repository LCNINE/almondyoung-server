import { randomUUID } from 'node:crypto';
import { and, eq, max, ne } from 'drizzle-orm';
import { ConflictError, ForbiddenError } from '@app/shared';
import { FileServiceClient } from '../../library/clients/file-service.client';
import { DbTx, sku3dModels } from '../schema/inventory.schema';
import { Sku3dModelsManager } from '../sku-3d-models/sku-3d-models.manager';
import { actor, finishedRevision, seedSku, startWorkshopDb, WorkshopTestDb } from './__support__/workshop-db';
import { Sku3dWorkshopManager } from './sku-3d-workshop.manager';
import { Sku3dWorkshopPublisher } from './sku-3d-workshop.publisher';

const describeWithPostgres = process.env.REQUIRE_SKU_3D_WORKSHOP_DB === '1' ? describe : describe.skip;

describeWithPostgres('SKU 3D workshop approve (PostgreSQL)', () => {
  jest.setTimeout(180_000);

  let t: WorkshopTestDb;
  let workshops: Sku3dWorkshopManager;
  let publisher: Sku3dWorkshopPublisher;
  let failPublish = false;
  const upload = jest.fn();
  const fetchFile = jest.fn();
  const files = { upload, fetchFile } as unknown as FileServiceClient;

  // 기존 등록·공개와 같은 행 변화만 흉내 낸다 — 투영·파일 검사는 sku-3d-models 스펙의 몫
  const register = jest.fn(
    async (skuId: string, input: { glbFileId?: string }, actorId: string, _label: string, tx: DbTx) => {
      const [latest] = await tx
        .select({ v: max(sku3dModels.version) })
        .from(sku3dModels)
        .where(eq(sku3dModels.skuId, skuId));
      const [model] = await tx
        .insert(sku3dModels)
        .values({
          skuId,
          version: (latest?.v ?? 0) + 1,
          glbFileId: input.glbFileId,
          status: 'draft',
          uploadedById: actorId,
        })
        .returning();

      return model;
    },
  );
  const publish = jest.fn(async (id: string, _actorId: string, tx: DbTx) => {
    const [model] = await tx.select().from(sku3dModels).where(eq(sku3dModels.id, id));

    await tx
      .update(sku3dModels)
      .set({ status: 'draft' })
      .where(and(eq(sku3dModels.skuId, model.skuId), eq(sku3dModels.status, 'approved'), ne(sku3dModels.id, id)));

    if (failPublish) {
      throw new Error('publish 실패');
    }

    const [published] = await tx
      .update(sku3dModels)
      .set({ status: 'approved' })
      .where(eq(sku3dModels.id, id))
      .returning();

    return published;
  });
  const models = { register, publish } as unknown as Sku3dModelsManager;

  beforeAll(async () => {
    t = await startWorkshopDb();
    workshops = new Sku3dWorkshopManager(t.dbService, { tenantId: () => 'tenant-a' });
    publisher = new Sku3dWorkshopPublisher(t.dbService, files, models);
  });

  afterAll(async () => {
    await t.client.end();
    await t.container.stop();
  });

  beforeEach(() => {
    failPublish = false;
    upload.mockReset();
    upload.mockImplementation(() => Promise.resolve({ fileId: randomUUID() }));
    fetchFile.mockReset();
    fetchFile.mockImplementation(() =>
      Promise.resolve({ stream: new Response(new Uint8Array([7, 7])).body, contentType: 'model/gltf-binary' }),
    );
  });

  async function readyRevision(owner = actor({ canPublish: true })) {
    const skuId = await seedSku(t.db);
    const workshop = await workshops.open(skuId, owner);

    await workshops.confirmDimensions(workshop.id, owner, 'package');

    const revisionId = await finishedRevision(t.db, workshop.id, 'b'.repeat(64));

    return { owner, skuId, workshop, revisionId };
  }

  async function modelsOf(skuId: string) {
    return t.db.select().from(sku3dModels).where(eq(sku3dModels.skuId, skuId));
  }

  it('rejects stale hash', async () => {
    const { owner, skuId, workshop, revisionId } = await readyRevision();

    await expect(publisher.approve(workshop.id, revisionId, 'c'.repeat(64), owner)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(upload).not.toHaveBeenCalled();
    expect(await modelsOf(skuId)).toHaveLength(0);
  });

  it('approve publishes once', async () => {
    const { owner, skuId, workshop, revisionId } = await readyRevision();
    const first = await publisher.approve(workshop.id, revisionId, 'b'.repeat(64), owner);
    const second = await publisher.approve(workshop.id, revisionId, 'b'.repeat(64), owner);
    const rows = await modelsOf(skuId);

    expect(second).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('approved');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'sku-3d-model', isPublic: true }));
  });

  it('retry after failure creates one version', async () => {
    const { owner, skuId, workshop, revisionId } = await readyRevision();

    failPublish = true;
    await expect(publisher.approve(workshop.id, revisionId, 'b'.repeat(64), owner)).rejects.toThrow('publish 실패');

    failPublish = false;
    await publisher.approve(workshop.id, revisionId, 'b'.repeat(64), owner);

    const rows = await modelsOf(skuId);

    expect(rows).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'approved')).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('keeps previous public model until publish', async () => {
    const { owner, skuId, workshop, revisionId } = await readyRevision();

    await t.db.insert(sku3dModels).values({ skuId, version: 1, glbFileId: randomUUID(), status: 'approved' });

    failPublish = true;
    await expect(publisher.approve(workshop.id, revisionId, 'b'.repeat(64), owner)).rejects.toThrow();

    const rows = await modelsOf(skuId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, status: 'approved' });
  });

  it('only owner approves', async () => {
    const { workshop, revisionId } = await readyRevision();

    await expect(
      publisher.approve(workshop.id, revisionId, 'b'.repeat(64), actor({ canManage: true, canPublish: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(upload).not.toHaveBeenCalled();
  });

  it('owner without publish permission is refused', async () => {
    const owner = actor({ canPublish: false });
    const { workshop, revisionId } = await readyRevision(owner);

    await expect(publisher.approve(workshop.id, revisionId, 'b'.repeat(64), owner)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
