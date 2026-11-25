import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import { FileServiceClient } from '../../library/clients/file-service.client';
import {
  DbTx,
  sku3dWorkshopEvents,
  sku3dWorkshopRevisions,
  sku3dWorkshops,
  wmsSchema,
} from '../schema/inventory.schema';
import { Sku3dModelsManager } from '../sku-3d-models/sku-3d-models.manager';
import { lockWorkshop } from './worker/sku-3d-worker.manager';
import { assertOwner, WorkshopActor } from './workshop-access';

export const PUBLIC_MODEL_CONTEXT_ID = 'sku-3d-model';

export type PublishedRevision = {
  revisionId: string;
  sku3dModelId: string;
  publishedAt: Date;
};

type Revision = typeof sku3dWorkshopRevisions.$inferSelect;
type Workshop = typeof sku3dWorkshops.$inferSelect;

// 승인 = 공개 업로드 → 기존 register(draft) → 기존 publish. 단계마다 revision 행에 찍고, 재시도는 찍힌 단계를 건너뛴다
@Injectable()
export class Sku3dWorkshopPublisher {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly files: FileServiceClient,
    private readonly models: Sku3dModelsManager,
  ) {}

  async approve(
    workshopId: string,
    revisionId: string,
    glbSha256: string,
    actor: WorkshopActor,
  ): Promise<PublishedRevision> {
    const { workshop, revision } = await this.load(workshopId, revisionId, actor);

    if (revision.glbSha256 !== glbSha256) {
      throw new ConflictError('보고 있는 버전이 바뀌었어요. 화면을 새로 보고 다시 승인해 주세요');
    }

    if (revision.publishedAt && revision.sku3dModelId) {
      return { revisionId, sku3dModelId: revision.sku3dModelId, publishedAt: revision.publishedAt };
    }

    const publicGlbFileId = revision.publicGlbFileId ?? (await this.uploadPublic(workshop, revision, actor));

    return this.db.run(async (trx) => {
      await lockWorkshop(trx, workshopId);

      const [locked] = await trx
        .select()
        .from(sku3dWorkshopRevisions)
        .where(eq(sku3dWorkshopRevisions.id, revisionId))
        .for('update');
      const sku3dModelId =
        locked.sku3dModelId ?? (await this.registerDraft(trx, workshop, locked, publicGlbFileId, actor));

      if (locked.publishedAt) {
        return { revisionId, sku3dModelId, publishedAt: locked.publishedAt };
      }

      await this.models.publish(sku3dModelId, actor.userId, trx);

      const publishedAt = new Date();

      await trx
        .update(sku3dWorkshopRevisions)
        .set({ approvedById: actor.userId, approvedAt: publishedAt, publishedAt })
        .where(eq(sku3dWorkshopRevisions.id, revisionId));
      await trx.insert(sku3dWorkshopEvents).values({
        workshopId,
        revisionId,
        type: 'status',
        authorLabel: actor.label,
        body: `v${locked.number} 을 승인해 쇼핑몰에 공개했어요`,
      });

      return { revisionId, sku3dModelId, publishedAt };
    });
  }

  private async load(workshopId: string, revisionId: string, actor: WorkshopActor) {
    const [row] = await this.db.db
      .select({ workshop: sku3dWorkshops, revision: sku3dWorkshopRevisions })
      .from(sku3dWorkshopRevisions)
      .innerJoin(sku3dWorkshops, eq(sku3dWorkshops.id, sku3dWorkshopRevisions.workshopId))
      .where(and(eq(sku3dWorkshopRevisions.id, revisionId), eq(sku3dWorkshopRevisions.workshopId, workshopId)));

    if (!row) {
      throw new NotFoundError('버전을 찾을 수 없어요');
    }

    assertOwner(row.workshop, actor);

    if (!actor.canPublish) {
      throw new ForbiddenError('쇼핑몰 공개 권한이 없어요');
    }

    return row;
  }

  private async uploadPublic(workshop: Workshop, revision: Revision, actor: WorkshopActor): Promise<string> {
    const fetched = await this.files.fetchFile(revision.glbFileId, workshop.ownerId);
    const bytes = new Uint8Array(await new Response(fetched.stream).arrayBuffer());
    const { fileId } = await this.files.upload({
      bytes,
      fileName: `workshop-${workshop.id}-v${revision.number}.glb`,
      mimeType: 'model/gltf-binary',
      contextId: PUBLIC_MODEL_CONTEXT_ID,
      isPublic: true,
      onBehalfOf: actor.userId,
    });
    // 동시에 두 번 눌렀으면 먼저 찍힌 파일을 쓴다 — 나중 파일은 고아로 남는다
    const [stamped] = await this.db.db
      .update(sku3dWorkshopRevisions)
      .set({ publicGlbFileId: fileId })
      .where(and(eq(sku3dWorkshopRevisions.id, revision.id), isNull(sku3dWorkshopRevisions.publicGlbFileId)))
      .returning({ publicGlbFileId: sku3dWorkshopRevisions.publicGlbFileId });

    if (stamped?.publicGlbFileId) {
      return stamped.publicGlbFileId;
    }

    const [current] = await this.db.db
      .select({ publicGlbFileId: sku3dWorkshopRevisions.publicGlbFileId })
      .from(sku3dWorkshopRevisions)
      .where(eq(sku3dWorkshopRevisions.id, revision.id));

    return current.publicGlbFileId ?? fileId;
  }

  private async registerDraft(
    trx: DbTx,
    workshop: Workshop,
    revision: Revision,
    publicGlbFileId: string,
    actor: WorkshopActor,
  ): Promise<string> {
    const model = await this.models.register(
      workshop.skuId,
      {
        status: 'draft',
        glbFileId: publicGlbFileId,
        notes: {
          workshopId: workshop.id,
          revisionId: revision.id,
          revisionNumber: revision.number,
          glbSha256: revision.glbSha256,
          review: revision.review,
        },
      },
      actor.userId,
      actor.label,
      trx,
    );

    await trx
      .update(sku3dWorkshopRevisions)
      .set({ sku3dModelId: model.id })
      .where(eq(sku3dWorkshopRevisions.id, revision.id));

    return model.id;
  }
}
