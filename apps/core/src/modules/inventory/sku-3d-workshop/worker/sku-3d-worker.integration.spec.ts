import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { BadRequestError, ConflictError, UnauthorizedError } from '@app/shared';
import { FileServiceClient } from '../../../library/clients/file-service.client';
import {
  Sku3dRevisionReview,
  sku3dWorkers,
  sku3dWorkshopEvents,
  sku3dWorkshopJobs,
  sku3dWorkshopRevisions,
  sku3dWorkshops,
} from '../../schema/inventory.schema';
import { actor, seedSku, startWorkshopDb, WorkshopTestDb } from '../__support__/workshop-db';
import { Sku3dWorkshopManager } from '../sku-3d-workshop.manager';
import { AuthenticatedWorker, hashWorkerKey, Sku3dWorkerManager } from './sku-3d-worker.manager';

const describeWithPostgres = process.env.REQUIRE_SKU_3D_WORKSHOP_DB === '1' ? describe : describe.skip;

const review: Sku3dRevisionReview = {
  summary: '몸체 비율은 맞지만 뚜껑 모서리가 각져 보입니다. 더 둥글게 다듬을까요?',
  verdict: 'ready_for_review',
  issues: [],
  proposals: ['뚜껑 모서리를 둥글게'],
  autoFixes: [],
  unseenFaces: ['밑면'],
  assumptions: [],
  needsPhotos: [],
  dimensionsUsed: { widthMm: 120, lengthMm: 45, heightMm: 30, basis: 'package' },
};

describeWithPostgres('SKU 3D worker API (PostgreSQL)', () => {
  jest.setTimeout(180_000);

  let t: WorkshopTestDb;
  let workshops: Sku3dWorkshopManager;
  let manager: Sku3dWorkerManager;
  let worker: AuthenticatedWorker;
  const upload = jest.fn();
  const files = { upload, fetchFile: jest.fn() } as unknown as FileServiceClient;

  beforeAll(async () => {
    t = await startWorkshopDb();
    workshops = new Sku3dWorkshopManager(t.dbService, { tenantId: () => 'tenant-a' });
    manager = new Sku3dWorkerManager(t.dbService, files);

    const [row] = await t.db
      .insert(sku3dWorkers)
      .values({ name: 'home-pc', keyHash: hashWorkerKey('k'.repeat(43)) })
      .returning();

    worker = { id: row.id, maxConcurrency: 1 };
  });

  afterAll(async () => {
    await t.client.end();
    await t.container.stop();
  });

  beforeEach(async () => {
    // 테스트마다 대기열을 비워 claim 이 다른 테스트 작업을 집지 않게 한다
    await t.db.execute(sql`UPDATE sku_3d_workshop_jobs SET status = 'cancelled' WHERE status IN ('queued','running')`);
    upload.mockReset();
    upload.mockImplementation(() => Promise.resolve({ fileId: randomUUID() }));
  });

  async function queuedJob() {
    const me = actor();
    const workshop = await workshops.open(await seedSku(t.db), me);
    const job = await workshops.confirmDimensions(workshop.id, me, 'package');

    return { me, workshop, job: job! };
  }

  async function expireLease(jobId: string) {
    await t.db.execute(
      sql`UPDATE sku_3d_workshop_jobs SET lease_until = now() - interval '1 second' WHERE id = ${jobId}`,
    );
  }

  async function uploadGlb(jobId: string, leaseToken: string, bytes = 1000) {
    return manager.upload(worker, jobId, leaseToken, {
      bytes: Buffer.alloc(bytes),
      name: 'model.glb',
      mimeType: 'model/gltf-binary',
    });
  }

  it('authenticates only live keys and stamps last_seen_at', async () => {
    await expect(manager.authenticate('x'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedError);

    const seen = await manager.authenticate('k'.repeat(43));
    const [row] = await t.db.select().from(sku3dWorkers).where(eq(sku3dWorkers.id, seen.id));

    expect(row.lastSeenAt).not.toBeNull();

    await t.db.update(sku3dWorkers).set({ revokedAt: new Date() }).where(eq(sku3dWorkers.id, seen.id));
    await expect(manager.authenticate('k'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedError);
    await t.db.update(sku3dWorkers).set({ revokedAt: null }).where(eq(sku3dWorkers.id, seen.id));
  });

  it('claim is exclusive', async () => {
    const { job } = await queuedJob();
    const others = Array.from({ length: 4 }, () => ({ id: randomUUID(), maxConcurrency: 1 }));
    const claims = await Promise.all([worker, ...others].map((w) => manager.claim(w)));

    expect(claims.filter((c) => c !== null)).toHaveLength(1);
    expect(claims.find((c) => c !== null)?.id).toBe(job.id);
  });

  it('respects max concurrency', async () => {
    await queuedJob();
    await queuedJob();

    expect(await manager.claim(worker)).not.toBeNull();
    expect(await manager.claim(worker)).toBeNull();
  });

  it('reclaims expired lease and fences old token', async () => {
    const { job } = await queuedJob();
    const first = await manager.claim(worker);

    await expireLease(job.id);

    const second = await manager.claim(worker);

    expect(second).toMatchObject({ id: job.id, attempts: 2 });
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    await expect(manager.heartbeat(worker, job.id, first!.leaseToken)).rejects.toBeInstanceOf(ConflictError);
    await expect(manager.heartbeat(worker, job.id, second!.leaseToken)).resolves.toBeUndefined();
  });

  it('rejects late complete after reclaim', async () => {
    const { job } = await queuedJob();
    const first = await manager.claim(worker);
    const glb = await uploadGlb(job.id, first!.leaseToken);

    await expireLease(job.id);
    await manager.claim(worker);

    await expect(
      manager.complete(worker, job.id, first!.leaseToken, {
        glbFileId: glb.fileId,
        renderFileIds: [],
        review,
        provenance: {},
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const revisions = await t.db.select().from(sku3dWorkshopRevisions).where(eq(sku3dWorkshopRevisions.jobId, job.id));

    expect(revisions).toHaveLength(0);
  });

  it('fails after three attempts', async () => {
    const { job } = await queuedJob();

    for (let i = 0; i < 3; i += 1) {
      await manager.claim(worker);
      await expireLease(job.id);
    }

    expect(await manager.claim(worker)).toBeNull();

    const [row] = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.id, job.id));

    expect(row.status).toBe('failed');
  });

  it('session id is write-once', async () => {
    const { job, workshop } = await queuedJob();
    const claimed = await manager.claim(worker);

    await manager.recordSession(worker, job.id, claimed!.leaseToken, 'session-aaaa-1111');
    await manager.recordSession(worker, job.id, claimed!.leaseToken, 'session-aaaa-1111');
    await expect(
      manager.recordSession(worker, job.id, claimed!.leaseToken, 'session-bbbb-2222'),
    ).rejects.toBeInstanceOf(ConflictError);

    const [row] = await t.db.select().from(sku3dWorkshops).where(eq(sku3dWorkshops.id, workshop.id));

    expect(row.codexSessionId).toBe('session-aaaa-1111');
  });

  it('uploads on behalf of the workshop owner and hashes the bytes itself', async () => {
    const { job, me } = await queuedJob();
    const claimed = await manager.claim(worker);
    const glb = await uploadGlb(job.id, claimed!.leaseToken, 3);

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ onBehalfOf: me.userId, contextId: 'sku-3d-workshop', isPublic: false }),
    );
    expect(glb.sha256).toBe('709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c');
  });

  it('complete requires uploaded files', async () => {
    const { job } = await queuedJob();
    const claimed = await manager.claim(worker);

    await expect(
      manager.complete(worker, job.id, claimed!.leaseToken, {
        glbFileId: randomUUID(),
        renderFileIds: [],
        review,
        provenance: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('complete rejects oversize glb', async () => {
    const { job } = await queuedJob();
    const claimed = await manager.claim(worker);
    const glb = await uploadGlb(job.id, claimed!.leaseToken, 2 * 1024 * 1024 + 1);

    await expect(
      manager.complete(worker, job.id, claimed!.leaseToken, {
        glbFileId: glb.fileId,
        renderFileIds: [],
        review,
        provenance: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('complete creates a revision and posts the review summary to chat', async () => {
    const { job, workshop } = await queuedJob();
    const claimed = await manager.claim(worker);
    const glb = await uploadGlb(job.id, claimed!.leaseToken);
    const { revisionId } = await manager.complete(worker, job.id, claimed!.leaseToken, {
      glbFileId: glb.fileId,
      renderFileIds: [],
      review,
      provenance: { blender: '5.2.5' },
    });
    const [revision] = await t.db
      .select()
      .from(sku3dWorkshopRevisions)
      .where(eq(sku3dWorkshopRevisions.id, revisionId));
    const events = await t.db.select().from(sku3dWorkshopEvents).where(eq(sku3dWorkshopEvents.workshopId, workshop.id));
    const [jobRow] = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.id, job.id));

    expect(revision).toMatchObject({ number: 1, glbSha256: glb.sha256, glbBytes: 1000 });
    expect(revision.provenance).toMatchObject({
      blender: '5.2.5',
      dimensions: { packageWidthMm: 120, basis: 'package' },
    });
    expect(jobRow.status).toBe('succeeded');
    expect(events.find((e) => e.type === 'assistant_message')?.body).toContain('더 둥글게 다듬을까요?');
  });

  it('retryable failure goes back to the queue, final failure stops', async () => {
    const { job } = await queuedJob();
    const first = await manager.claim(worker);

    await manager.fail(worker, job.id, first!.leaseToken, 'Blender 가 비정상 종료', true);

    const [queued] = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.id, job.id));

    expect(queued.status).toBe('queued');

    const second = await manager.claim(worker);

    await manager.fail(worker, job.id, second!.leaseToken, '입력 오류', false);

    const [failed] = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.id, job.id));

    expect(failed.status).toBe('failed');
  });

  it('browser disconnect does not cancel', async () => {
    const { job } = await queuedJob();
    const claimed = await manager.claim(worker);

    // 화면 쪽 호출이 하나도 없어도 lease 만 유지되면 작업은 그대로 진행된다
    await manager.heartbeat(worker, job.id, claimed!.leaseToken);

    const [row] = await t.db.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.id, job.id));

    expect(row.status).toBe('running');
  });
});
