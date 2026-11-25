import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import {
  DbTx,
  sku3dWorkers,
  sku3dWorkshopEvents,
  sku3dWorkshopJobs,
  sku3dWorkshopRevisions,
  sku3dWorkshops,
  skuReferencePhotos,
  skus,
  wmsSchema,
} from '../schema/inventory.schema';
import { FileServiceClient } from '../../library/clients/file-service.client';
import { assertCanView, WorkshopActor } from './workshop-access';
import type { Workshop, WorkshopJob } from './sku-3d-workshop.manager';

export const WORKER_ONLINE_WINDOW_MS = 60_000;
const EVENT_PAGE = 200;

export type WorkshopRevision = Omit<typeof sku3dWorkshopRevisions.$inferSelect, 'provenance'>;
export type WorkshopEvent = typeof sku3dWorkshopEvents.$inferSelect;

export type WorkshopDetail = {
  workshop: Workshop;
  sku: {
    id: string;
    code: string;
    name: string;
    packageWidthMm: number | null;
    packageLengthMm: number | null;
    packageHeightMm: number | null;
    packageWeightG: number | null;
    photos: { fileId: string; sortOrder: number }[];
  };
  activeJob: WorkshopJob | null;
  revisions: WorkshopRevision[];
  worker: { online: boolean; lastSeenAt: Date | null };
};

export type RevisionFile = { bytes: Buffer; contentType: string };

@Injectable()
export class Sku3dWorkshopReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly files: FileServiceClient,
  ) {}

  async detail(workshopId: string, actor: WorkshopActor, tx?: DbTx): Promise<WorkshopDetail> {
    return this.db.run(async (trx) => {
      const workshop = await this.visible(trx, workshopId, actor);
      const [sku] = await trx
        .select({
          id: skus.id,
          code: skus.code,
          name: skus.name,
          packageWidthMm: skus.packageWidthMm,
          packageLengthMm: skus.packageLengthMm,
          packageHeightMm: skus.packageHeightMm,
          packageWeightG: skus.packageWeightG,
        })
        .from(skus)
        .where(eq(skus.id, workshop.skuId));
      const photos = await trx
        .select({ fileId: skuReferencePhotos.fileId, sortOrder: skuReferencePhotos.sortOrder })
        .from(skuReferencePhotos)
        .where(eq(skuReferencePhotos.skuId, workshop.skuId))
        .orderBy(asc(skuReferencePhotos.sortOrder), asc(skuReferencePhotos.createdAt));
      const revisions = await this.revisions(trx, workshopId);

      return {
        workshop,
        sku: { ...sku, photos },
        activeJob: await this.activeJob(trx, workshopId),
        revisions,
        worker: await this.workerStatus(trx),
      };
    }, tx);
  }

  async events(
    workshopId: string,
    actor: WorkshopActor,
    afterSeq: number,
    tx?: DbTx,
  ): Promise<{ events: WorkshopEvent[]; activeJob: WorkshopJob | null }> {
    return this.db.run(async (trx) => {
      await this.visible(trx, workshopId, actor);

      const events = await trx
        .select()
        .from(sku3dWorkshopEvents)
        .where(and(eq(sku3dWorkshopEvents.workshopId, workshopId), gt(sku3dWorkshopEvents.seq, afterSeq)))
        .orderBy(asc(sku3dWorkshopEvents.seq))
        .limit(EVENT_PAGE);

      return { events, activeJob: await this.activeJob(trx, workshopId) };
    }, tx);
  }

  // kind: glb | render-<n> — 파일은 작업실 권한을 본 뒤에만 이름을 알려 준다
  async revisionFile(
    workshopId: string,
    revisionId: string,
    kind: string,
    actor: WorkshopActor,
    tx?: DbTx,
  ): Promise<RevisionFile> {
    const file = await this.db.run(async (trx) => {
      const workshop = await this.visible(trx, workshopId, actor);
      const [revision] = await trx
        .select()
        .from(sku3dWorkshopRevisions)
        .where(and(eq(sku3dWorkshopRevisions.id, revisionId), eq(sku3dWorkshopRevisions.workshopId, workshopId)));

      if (!revision) {
        throw new NotFoundError('버전을 찾을 수 없어요');
      }

      const fileId = fileIdOf(revision, kind);

      if (!fileId) {
        throw new NotFoundError('파일을 찾을 수 없어요');
      }

      return { ownerId: workshop.ownerId, fileId };
    }, tx);
    // 비공개 파일은 주인 대신 core 가 꺼낸다 — 권한 검사는 위에서 끝났다
    const fetched = await this.files.fetchFile(file.fileId, file.ownerId);

    return { bytes: Buffer.from(await new Response(fetched.stream).arrayBuffer()), contentType: fetched.contentType };
  }

  async workerStatus(trx: DbTx): Promise<{ online: boolean; lastSeenAt: Date | null }> {
    const [row] = await trx
      .select({ lastSeenAt: sql<Date | null>`max(${sku3dWorkers.lastSeenAt})` })
      .from(sku3dWorkers)
      .where(isNull(sku3dWorkers.revokedAt));
    const lastSeenAt = row?.lastSeenAt ? new Date(row.lastSeenAt) : null;

    return {
      online: lastSeenAt !== null && Date.now() - lastSeenAt.getTime() < WORKER_ONLINE_WINDOW_MS,
      lastSeenAt,
    };
  }

  private async visible(trx: DbTx, workshopId: string, actor: WorkshopActor): Promise<Workshop> {
    const [workshop] = await trx.select().from(sku3dWorkshops).where(eq(sku3dWorkshops.id, workshopId));

    if (!workshop) {
      throw new NotFoundError('3D 작업실을 찾을 수 없어요');
    }

    assertCanView(workshop, actor);

    return workshop;
  }

  private async activeJob(trx: DbTx, workshopId: string): Promise<WorkshopJob | null> {
    const [job] = await trx
      .select()
      .from(sku3dWorkshopJobs)
      .where(
        and(eq(sku3dWorkshopJobs.workshopId, workshopId), inArray(sku3dWorkshopJobs.status, ['queued', 'running'])),
      );

    return job ?? null;
  }

  private async revisions(trx: DbTx, workshopId: string): Promise<WorkshopRevision[]> {
    return trx
      .select({
        id: sku3dWorkshopRevisions.id,
        workshopId: sku3dWorkshopRevisions.workshopId,
        jobId: sku3dWorkshopRevisions.jobId,
        number: sku3dWorkshopRevisions.number,
        glbFileId: sku3dWorkshopRevisions.glbFileId,
        glbSha256: sku3dWorkshopRevisions.glbSha256,
        glbBytes: sku3dWorkshopRevisions.glbBytes,
        files: sku3dWorkshopRevisions.files,
        review: sku3dWorkshopRevisions.review,
        createdAt: sku3dWorkshopRevisions.createdAt,
        approvedById: sku3dWorkshopRevisions.approvedById,
        approvedAt: sku3dWorkshopRevisions.approvedAt,
        publicGlbFileId: sku3dWorkshopRevisions.publicGlbFileId,
        sku3dModelId: sku3dWorkshopRevisions.sku3dModelId,
        publishedAt: sku3dWorkshopRevisions.publishedAt,
      })
      .from(sku3dWorkshopRevisions)
      .where(eq(sku3dWorkshopRevisions.workshopId, workshopId))
      .orderBy(desc(sku3dWorkshopRevisions.number));
  }
}

function fileIdOf(revision: typeof sku3dWorkshopRevisions.$inferSelect, kind: string): string | null {
  if (kind === 'glb') {
    return revision.glbFileId;
  }

  const render = /^render-(\d+)$/.exec(kind);

  if (!render) {
    return null;
  }

  return revision.files.renders[Number(render[1])] ?? null;
}
