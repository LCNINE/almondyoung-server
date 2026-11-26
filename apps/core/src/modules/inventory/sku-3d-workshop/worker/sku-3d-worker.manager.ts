import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, max, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '@app/shared';
import { FileServiceClient } from '../../../library/clients/file-service.client';
import {
  DbTx,
  Sku3dJobUpload,
  Sku3dRevisionReview,
  sku3dWorkers,
  sku3dWorkshopEvents,
  sku3dWorkshopJobs,
  sku3dWorkshopRevisions,
  sku3dWorkshops,
  skuReferencePhotos,
  skus,
  wmsSchema,
} from '../../schema/inventory.schema';
import type { WorkshopJob } from '../sku-3d-workshop.manager';
import { materialChanges, MaterialChanges, materialInputsOf } from '../material-changes';

export const WORKSHOP_FILE_CONTEXT_ID = 'sku-3d-workshop';
export const GLB_MAX_BYTES = 2 * 1024 * 1024;
export const RENDER_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 120;

export type AuthenticatedWorker = { id: string; maxConcurrency: number };

export type ClaimedJob = Pick<WorkshopJob, 'id' | 'kind' | 'workshopId' | 'attempts'> & { leaseToken: string };

export type JobInputSnapshot = {
  sku: {
    code: string;
    name: string;
    packageWidthMm: number | null;
    packageLengthMm: number | null;
    packageHeightMm: number | null;
    packageWeightG: number | null;
    dimensionBasis: string;
  };
  photos: { fileId: string; sortOrder: number }[];
  request: string;
  base: { revisionId: string; number: number; files: Record<string, string> } | null;
  // 기준 버전을 만든 뒤 바뀐 실측 자료 — Codex 에게 무엇이 바뀌었는지 알려 준다
  changes: MaterialChanges | null;
};

export type JobInputs = JobInputSnapshot & { sessionId: string | null; iteration: number };

export type CompleteJobInput = {
  glbFileId: string;
  renderFileIds: string[];
  pythonFileId?: string;
  blendFileId?: string;
  planFileId?: string;
  review: Sku3dRevisionReview;
  provenance: Record<string, unknown>;
};

export function hashWorkerKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class Sku3dWorkerManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly files: FileServiceClient,
  ) {}

  async authenticate(key: string, tx?: DbTx): Promise<AuthenticatedWorker> {
    return this.db.run(async (trx) => {
      const [worker] = await trx
        .update(sku3dWorkers)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(sku3dWorkers.keyHash, hashWorkerKey(key)), isNull(sku3dWorkers.revokedAt)))
        .returning({ id: sku3dWorkers.id, maxConcurrency: sku3dWorkers.maxConcurrency });

      if (!worker) {
        throw new UnauthorizedError('워커 키가 맞지 않아요');
      }

      return worker;
    }, tx);
  }

  async claim(worker: AuthenticatedWorker, tx?: DbTx): Promise<ClaimedJob | null> {
    return this.db.run(async (trx) => {
      await this.closeExhausted(trx);
      // 같은 워커의 claim 을 줄 세운다 — 둘이 동시에 busy=0 을 읽고 한도를 넘지 않게
      await trx.select({ id: sku3dWorkers.id }).from(sku3dWorkers).where(eq(sku3dWorkers.id, worker.id)).for('update');

      const [busy] = await trx
        .select({ n: count() })
        .from(sku3dWorkshopJobs)
        .where(
          and(
            eq(sku3dWorkshopJobs.workerId, worker.id),
            eq(sku3dWorkshopJobs.status, 'running'),
            gt(sku3dWorkshopJobs.leaseUntil, sql`now()`),
          ),
        );

      if ((busy?.n ?? 0) >= worker.maxConcurrency) {
        return null;
      }

      const leaseToken = randomUUID();
      // 만료된 running 도 다시 가져간다 — 옛 lease_token 은 여기서 무효가 된다
      const claimed = await trx.execute<{
        id: string;
        kind: 'create' | 'revise';
        workshop_id: string;
        attempts: number;
      }>(sql`
        UPDATE sku_3d_workshop_jobs
        SET status = 'running', lease_token = ${leaseToken}, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
            attempts = attempts + 1, worker_id = ${worker.id}, started_at = coalesce(started_at, now())
        WHERE id = (
          SELECT id FROM sku_3d_workshop_jobs
          WHERE (status = 'queued' OR (status = 'running' AND lease_until < now())) AND attempts < ${MAX_ATTEMPTS}
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, kind, workshop_id, attempts
      `);
      const [row] = claimed;

      if (!row) {
        return null;
      }

      await lockWorkshop(trx, row.workshop_id);
      await trx.insert(sku3dWorkshopEvents).values({
        workshopId: row.workshop_id,
        jobId: row.id,
        type: 'status',
        body: row.attempts > 1 ? `작업 PC 가 다시 가져갔어요 (${row.attempts}번째)` : '작업 PC 가 가져갔어요',
      });

      return { id: row.id, kind: row.kind, workshopId: row.workshop_id, attempts: row.attempts, leaseToken };
    }, tx);
  }

  async heartbeat(worker: AuthenticatedWorker, jobId: string, leaseToken: string, tx?: DbTx): Promise<void> {
    await this.db.run(async (trx) => {
      await this.leased(trx, worker, jobId, leaseToken);
      await trx
        .update(sku3dWorkshopJobs)
        .set({ leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
        .where(eq(sku3dWorkshopJobs.id, jobId));
    }, tx);
  }

  async recordSession(
    worker: AuthenticatedWorker,
    jobId: string,
    leaseToken: string,
    sessionId: string,
    tx?: DbTx,
  ): Promise<void> {
    await this.db.run(async (trx) => {
      const job = await this.leased(trx, worker, jobId, leaseToken);
      // 세션 id 는 한 번만 적는다 — 다른 세션으로 갈아끼우면 대화가 끊긴다
      const updated = await trx
        .update(sku3dWorkshops)
        .set({ codexSessionId: sessionId, updatedAt: new Date() })
        .where(
          and(
            eq(sku3dWorkshops.id, job.workshopId),
            sql`(${sku3dWorkshops.codexSessionId} IS NULL OR ${sku3dWorkshops.codexSessionId} = ${sessionId})`,
          ),
        )
        .returning({ id: sku3dWorkshops.id });

      if (updated.length === 0) {
        throw new ConflictError('이 작업실에는 이미 다른 Codex 세션이 있어요');
      }
    }, tx);
  }

  async addEvents(
    worker: AuthenticatedWorker,
    jobId: string,
    leaseToken: string,
    items: { type: 'progress' | 'status'; body: string }[],
    tx?: DbTx,
  ): Promise<void> {
    await this.db.run(async (trx) => {
      const job = await this.leased(trx, worker, jobId, leaseToken);

      if (items.length === 0) {
        return;
      }

      await lockWorkshop(trx, job.workshopId);
      await trx
        .insert(sku3dWorkshopEvents)
        .values(items.map((item) => ({ workshopId: job.workshopId, jobId, type: item.type, body: item.body })));
    }, tx);
  }

  async inputs(worker: AuthenticatedWorker, jobId: string, leaseToken: string, tx?: DbTx): Promise<JobInputs> {
    return this.db.run(async (trx) => {
      const job = await this.leased(trx, worker, jobId, leaseToken);
      const [workshop] = await trx.select().from(sku3dWorkshops).where(eq(sku3dWorkshops.id, job.workshopId));
      const snapshot = isSnapshot(job.inputSnapshot) ? job.inputSnapshot : await this.snapshot(trx, job, workshop);
      const [latest] = await trx
        .select({ n: max(sku3dWorkshopRevisions.number) })
        .from(sku3dWorkshopRevisions)
        .where(eq(sku3dWorkshopRevisions.workshopId, job.workshopId));

      return { ...snapshot, sessionId: workshop.codexSessionId, iteration: (latest?.n ?? 0) + 1 };
    }, tx);
  }

  // 워커는 그 작업의 원본 사진과 기준 버전 파일만 받는다
  async file(worker: AuthenticatedWorker, jobId: string, leaseToken: string, fileId: string) {
    const ownerId = await this.db.run(async (trx) => {
      const job = await this.leased(trx, worker, jobId, leaseToken);
      const [workshop] = await trx.select().from(sku3dWorkshops).where(eq(sku3dWorkshops.id, job.workshopId));
      const snapshot = isSnapshot(job.inputSnapshot) ? job.inputSnapshot : await this.snapshot(trx, job, workshop);
      const allowed = [...snapshot.photos.map((p) => p.fileId), ...Object.values(snapshot.base?.files ?? {})];

      if (!allowed.includes(fileId)) {
        throw new NotFoundError('이 작업의 파일이 아니에요');
      }

      return workshop.ownerId;
    });
    const fetched = await this.files.fetchFile(fileId, ownerId);

    return { bytes: Buffer.from(await new Response(fetched.stream).arrayBuffer()), contentType: fetched.contentType };
  }

  async upload(
    worker: AuthenticatedWorker,
    jobId: string,
    leaseToken: string,
    file: { bytes: Buffer; name: string; mimeType: string },
  ): Promise<Sku3dJobUpload> {
    const ownerId = await this.db.run(async (trx) => {
      const job = await this.leased(trx, worker, jobId, leaseToken);
      const [workshop] = await trx
        .select({ ownerId: sku3dWorkshops.ownerId })
        .from(sku3dWorkshops)
        .where(eq(sku3dWorkshops.id, job.workshopId));

      return workshop.ownerId;
    });
    // 해시는 워커가 아니라 core 가 받은 바이트로 계산한다
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    const { fileId } = await this.files.upload({
      bytes: file.bytes,
      fileName: file.name,
      mimeType: file.mimeType,
      contextId: WORKSHOP_FILE_CONTEXT_ID,
      isPublic: false,
      onBehalfOf: ownerId,
    });
    const uploaded: Sku3dJobUpload = { fileId, name: file.name, sha256, bytes: file.bytes.length };

    await this.db.run(async (trx) => {
      await this.leased(trx, worker, jobId, leaseToken);
      await trx
        .update(sku3dWorkshopJobs)
        .set({ uploads: sql`${sku3dWorkshopJobs.uploads} || ${JSON.stringify([uploaded])}::jsonb` })
        .where(eq(sku3dWorkshopJobs.id, jobId));
    });

    return uploaded;
  }

  async complete(
    worker: AuthenticatedWorker,
    jobId: string,
    leaseToken: string,
    input: CompleteJobInput,
    tx?: DbTx,
  ): Promise<{ revisionId: string }> {
    return this.db.run(async (trx) => {
      const job = await this.leased(trx, worker, jobId, leaseToken);
      const uploads = new Map(job.uploads.map((u) => [u.fileId, u]));
      const referenced = [
        input.glbFileId,
        ...input.renderFileIds,
        input.pythonFileId,
        input.blendFileId,
        input.planFileId,
      ].filter((id): id is string => id !== undefined);

      if (referenced.some((id) => !uploads.has(id))) {
        throw new BadRequestError('이 작업으로 올리지 않은 파일이 있어요');
      }

      const glb = uploads.get(input.glbFileId);

      if (!glb) {
        throw new BadRequestError('GLB 파일이 없어요');
      }

      if (glb.bytes > GLB_MAX_BYTES) {
        throw new BadRequestError(`GLB 가 ${GLB_MAX_BYTES} 바이트를 넘어요`);
      }

      // 화면에 흘려 주는 파일은 GLB 와 렌더뿐이다 — 크기를 묶어 core 메모리를 지킨다
      if (input.renderFileIds.some((id) => (uploads.get(id)?.bytes ?? 0) > RENDER_MAX_BYTES)) {
        throw new BadRequestError(`렌더 이미지가 ${RENDER_MAX_BYTES} 바이트를 넘어요`);
      }

      const [workshop] = await trx
        .select()
        .from(sku3dWorkshops)
        .where(eq(sku3dWorkshops.id, job.workshopId))
        .for('update');
      const snapshot = isSnapshot(job.inputSnapshot) ? job.inputSnapshot : await this.snapshot(trx, job, workshop);
      const [latest] = await trx
        .select({ n: max(sku3dWorkshopRevisions.number) })
        .from(sku3dWorkshopRevisions)
        .where(eq(sku3dWorkshopRevisions.workshopId, job.workshopId));
      const [revision] = await trx
        .insert(sku3dWorkshopRevisions)
        .values({
          workshopId: job.workshopId,
          jobId,
          number: (latest?.n ?? 0) + 1,
          glbFileId: glb.fileId,
          glbSha256: glb.sha256,
          glbBytes: glb.bytes,
          files: {
            renders: input.renderFileIds,
            python: input.pythonFileId ?? null,
            blend: input.blendFileId ?? null,
            plan: input.planFileId ?? null,
          },
          review: input.review,
          provenance: {
            ...input.provenance,
            inputs: snapshot,
            codexSessionId: workshop.codexSessionId,
            uploads: job.uploads,
          },
        })
        .returning({ id: sku3dWorkshopRevisions.id });

      await trx
        .update(sku3dWorkshopJobs)
        .set({ status: 'succeeded', finishedAt: new Date(), leaseToken: null, leaseUntil: null })
        .where(eq(sku3dWorkshopJobs.id, jobId));
      await trx.insert(sku3dWorkshopEvents).values({
        workshopId: job.workshopId,
        jobId,
        revisionId: revision.id,
        type: 'assistant_message',
        body: assistantMessageOf(input.review),
      });
      await trx.update(sku3dWorkshops).set({ updatedAt: new Date() }).where(eq(sku3dWorkshops.id, job.workshopId));

      return { revisionId: revision.id };
    }, tx);
  }

  async fail(
    worker: AuthenticatedWorker,
    jobId: string,
    leaseToken: string,
    error: string,
    retryable: boolean,
    tx?: DbTx,
  ): Promise<void> {
    await this.db.run(async (trx) => {
      const job = await this.leased(trx, worker, jobId, leaseToken);
      const retry = retryable && job.attempts < MAX_ATTEMPTS;

      await lockWorkshop(trx, job.workshopId);

      await trx
        .update(sku3dWorkshopJobs)
        .set(
          retry
            ? { status: 'queued', leaseToken: null, leaseUntil: null, error }
            : { status: 'failed', leaseToken: null, leaseUntil: null, error, finishedAt: new Date() },
        )
        .where(eq(sku3dWorkshopJobs.id, jobId));
      await trx.insert(sku3dWorkshopEvents).values({
        workshopId: job.workshopId,
        jobId,
        type: 'status',
        body: retry ? `다시 시도할게요: ${error.slice(0, 300)}` : `만들지 못했어요: ${error.slice(0, 300)}`,
      });
    }, tx);
  }

  // 펜싱 — 지금 lease 를 쥔 워커만 통과한다. 늦게 온 결과는 여기서 409
  private async leased(
    trx: DbTx,
    worker: AuthenticatedWorker,
    jobId: string,
    leaseToken: string,
  ): Promise<WorkshopJob> {
    const [job] = await trx.select().from(sku3dWorkshopJobs).where(eq(sku3dWorkshopJobs.id, jobId)).for('update');

    if (!job) {
      throw new NotFoundError('작업을 찾을 수 없어요');
    }

    if (job.status !== 'running' || job.leaseToken !== leaseToken || job.workerId !== worker.id) {
      throw new ConflictError('이 작업의 lease 가 더 이상 유효하지 않아요');
    }

    return job;
  }

  private async closeExhausted(trx: DbTx): Promise<void> {
    const closed = await trx
      .update(sku3dWorkshopJobs)
      .set({
        status: 'failed',
        error: `${MAX_ATTEMPTS}번 시도했지만 끝나지 않았어요`,
        finishedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(sku3dWorkshopJobs.status, 'running'),
          sql`${sku3dWorkshopJobs.leaseUntil} < now()`,
          sql`${sku3dWorkshopJobs.attempts} >= ${MAX_ATTEMPTS}`,
        ),
      )
      .returning({ id: sku3dWorkshopJobs.id, workshopId: sku3dWorkshopJobs.workshopId });

    if (closed.length === 0) {
      return;
    }

    for (const job of closed) {
      await lockWorkshop(trx, job.workshopId);
    }

    await trx.insert(sku3dWorkshopEvents).values(
      closed.map((job) => ({
        workshopId: job.workshopId,
        jobId: job.id,
        type: 'status' as const,
        body: '작업 PC 가 여러 번 끊겨서 멈췄어요. 다시 요청해 주세요',
      })),
    );
  }

  private async snapshot(
    trx: DbTx,
    job: WorkshopJob,
    workshop: typeof sku3dWorkshops.$inferSelect,
  ): Promise<JobInputSnapshot> {
    const [sku] = await trx.select().from(skus).where(eq(skus.id, workshop.skuId));
    const [base] = job.baseRevisionId
      ? await trx.select().from(sku3dWorkshopRevisions).where(eq(sku3dWorkshopRevisions.id, job.baseRevisionId))
      : [];
    const sku3d = {
      sku: {
        code: sku.code,
        name: sku.name,
        packageWidthMm: sku.packageWidthMm,
        packageLengthMm: sku.packageLengthMm,
        packageHeightMm: sku.packageHeightMm,
        packageWeightG: sku.packageWeightG,
        dimensionBasis: workshop.dimensionBasis,
      },
      photos: await this.photosOf(trx, workshop.skuId),
    };
    const snapshot: JobInputSnapshot = {
      ...sku3d,
      request: job.request,
      base: base ? { revisionId: base.id, number: base.number, files: baseFilesOf(base) } : null,
      changes: base ? materialChanges(materialInputsOf(base.provenance), sku3d) : null,
    };

    await trx.update(sku3dWorkshopJobs).set({ inputSnapshot: snapshot }).where(eq(sku3dWorkshopJobs.id, job.id));

    return snapshot;
  }

  private async photosOf(trx: DbTx, skuId: string) {
    return trx
      .select({ fileId: skuReferencePhotos.fileId, sortOrder: skuReferencePhotos.sortOrder })
      .from(skuReferencePhotos)
      .where(eq(skuReferencePhotos.skuId, skuId))
      .orderBy(asc(skuReferencePhotos.sortOrder), asc(skuReferencePhotos.createdAt));
  }
}

// 이벤트를 쓰는 모든 경로가 작업실 행을 먼저 잠근다 — seq 가 커밋 순서대로 나가야 커서 폴링이 늦게 커밋된 이벤트를 건너뛰지 않는다
export async function lockWorkshop(trx: DbTx, workshopId: string): Promise<void> {
  await trx
    .select({ id: sku3dWorkshops.id })
    .from(sku3dWorkshops)
    .where(eq(sku3dWorkshops.id, workshopId))
    .for('update');
}

function isSnapshot(value: unknown): value is JobInputSnapshot {
  return typeof value === 'object' && value !== null && 'sku' in value && 'photos' in value;
}

function baseFilesOf(revision: typeof sku3dWorkshopRevisions.$inferSelect): Record<string, string> {
  const files: Record<string, string> = { 'model.glb': revision.glbFileId };

  revision.files.renders.forEach((id, i) => {
    files[`renders/${i}.png`] = id;
  });

  for (const [name, id] of [
    ['build.py', revision.files.python],
    ['model.blend', revision.files.blend],
    ['plan.md', revision.files.plan],
  ] as const) {
    if (id) {
      files[name] = id;
    }
  }

  return files;
}

function assistantMessageOf(review: Sku3dRevisionReview): string {
  const proposals = review.proposals.map((p) => `- ${p}`).join('\n');

  return proposals ? `${review.summary}\n\n${proposals}` : review.summary;
}
