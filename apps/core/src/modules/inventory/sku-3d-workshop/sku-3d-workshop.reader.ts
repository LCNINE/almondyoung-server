import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import {
  DbTx,
  Sku3dJobKind,
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
import { materialChanges, MaterialChanges, materialInputsOf } from './material-changes';
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
  // 마지막 버전을 만든 뒤 실측 사진·치수가 바뀌었으면 그 차이
  materialChanges: MaterialChanges | null;
};

export type RevisionFile = { bytes: Buffer; contentType: string };

// making: 만드는 중 / review: 확인할 버전이 있음 / failed: 마지막 작업이 실패 / public: 마지막 버전이 공개됨 / waiting: 아직 요청 전
export type MyWorkshopStatus = 'making' | 'review' | 'failed' | 'public' | 'waiting';

export type MyWorkshop = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  photoFileId: string | null;
  status: MyWorkshopStatus;
  latestRevisionNumber: number | null;
  activeJobKind: Sku3dJobKind | null;
  failedError: string | null;
  updatedAt: Date;
};

const MY_WORKSHOP_LIMIT = 200;

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
      const [latest] = await trx
        .select({ provenance: sku3dWorkshopRevisions.provenance })
        .from(sku3dWorkshopRevisions)
        .where(eq(sku3dWorkshopRevisions.workshopId, workshopId))
        .orderBy(desc(sku3dWorkshopRevisions.number))
        .limit(1);
      const current = {
        photos,
        sku: {
          packageWidthMm: sku.packageWidthMm,
          packageLengthMm: sku.packageLengthMm,
          packageHeightMm: sku.packageHeightMm,
          packageWeightG: sku.packageWeightG,
          dimensionBasis: workshop.dimensionBasis,
        },
      };

      return {
        workshop,
        sku: { ...sku, photos },
        activeJob: await this.activeJob(trx, workshopId),
        revisions,
        worker: await this.workerStatus(trx),
        materialChanges: materialChanges(materialInputsOf(latest?.provenance), current),
      };
    }, tx);
  }

  // ponytail: 최근 200개까지만 — 한 사람이 그보다 많이 쌓으면 페이지를 붙인다
  async mine(actor: WorkshopActor, tx?: DbTx): Promise<MyWorkshop[]> {
    return this.db.run(async (trx) => {
      const workshops = await trx
        .select({
          id: sku3dWorkshops.id,
          skuId: sku3dWorkshops.skuId,
          skuCode: skus.code,
          skuName: skus.name,
          updatedAt: sku3dWorkshops.updatedAt,
        })
        .from(sku3dWorkshops)
        .innerJoin(skus, eq(skus.id, sku3dWorkshops.skuId))
        .where(and(eq(sku3dWorkshops.ownerId, actor.userId), eq(skus.isDeleted, false)))
        .orderBy(desc(sku3dWorkshops.updatedAt), asc(sku3dWorkshops.id))
        .limit(MY_WORKSHOP_LIMIT);

      if (workshops.length === 0) {
        return [];
      }

      const ids = workshops.map((w) => w.id);
      // ponytail: 작업별 최신 행은 workshop_id 인덱스 없이 찾는다 — 작업 행이 수만을 넘어 느려지면 (workshop_id, created_at) 인덱스
      const jobs = await trx
        .selectDistinctOn([sku3dWorkshopJobs.workshopId], {
          workshopId: sku3dWorkshopJobs.workshopId,
          kind: sku3dWorkshopJobs.kind,
          status: sku3dWorkshopJobs.status,
          error: sku3dWorkshopJobs.error,
        })
        .from(sku3dWorkshopJobs)
        .where(inArray(sku3dWorkshopJobs.workshopId, ids))
        .orderBy(sku3dWorkshopJobs.workshopId, desc(sku3dWorkshopJobs.createdAt));
      const revisions = await trx
        .selectDistinctOn([sku3dWorkshopRevisions.workshopId], {
          workshopId: sku3dWorkshopRevisions.workshopId,
          number: sku3dWorkshopRevisions.number,
          publishedAt: sku3dWorkshopRevisions.publishedAt,
        })
        .from(sku3dWorkshopRevisions)
        .where(inArray(sku3dWorkshopRevisions.workshopId, ids))
        .orderBy(sku3dWorkshopRevisions.workshopId, desc(sku3dWorkshopRevisions.number));
      const photos = await trx
        .selectDistinctOn([skuReferencePhotos.skuId], {
          skuId: skuReferencePhotos.skuId,
          fileId: skuReferencePhotos.fileId,
        })
        .from(skuReferencePhotos)
        .where(
          inArray(
            skuReferencePhotos.skuId,
            workshops.map((w) => w.skuId),
          ),
        )
        .orderBy(skuReferencePhotos.skuId, asc(skuReferencePhotos.sortOrder), asc(skuReferencePhotos.createdAt));
      const jobOf = new Map(jobs.map((j) => [j.workshopId, j]));
      const revisionOf = new Map(revisions.map((r) => [r.workshopId, r]));
      const photoOf = new Map(photos.map((p) => [p.skuId, p.fileId]));

      return workshops.map((w) => {
        const job = jobOf.get(w.id);
        const revision = revisionOf.get(w.id);
        const active = job?.status === 'queued' || job?.status === 'running';

        return {
          ...w,
          photoFileId: photoOf.get(w.skuId) ?? null,
          status: myWorkshopStatus(job?.status ?? null, revision ?? null),
          latestRevisionNumber: revision?.number ?? null,
          activeJobKind: active && job ? job.kind : null,
          failedError: job?.status === 'failed' ? job.error : null,
        };
      });
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

export function myWorkshopStatus(
  latestJobStatus: string | null,
  latestRevision: { publishedAt: Date | null } | null,
): MyWorkshopStatus {
  if (latestJobStatus === 'queued' || latestJobStatus === 'running') {
    return 'making';
  }

  if (latestJobStatus === 'failed') {
    return 'failed';
  }

  if (!latestRevision) {
    return 'waiting';
  }

  return latestRevision.publishedAt ? 'public' : 'review';
}
