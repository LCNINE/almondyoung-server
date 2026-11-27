import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { OutboundTenant } from '@app/tenancy';
import { TenantContextMissingError } from '../../../platform/tenancy/core-tenant-db-router';
import {
  DbTx,
  Sku3dDimensionBasis,
  sku3dWorkshopEvents,
  sku3dWorkshopJobs,
  sku3dWorkshopRevisions,
  sku3dWorkshops,
  skus,
  wmsSchema,
} from '../schema/inventory.schema';
import { assertOwner, WorkshopActor } from './workshop-access';

export type Workshop = typeof sku3dWorkshops.$inferSelect;
export type WorkshopJob = typeof sku3dWorkshopJobs.$inferSelect;

const ACTIVE_STATUSES = ['queued', 'running'] as const;

@Injectable()
export class Sku3dWorkshopManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    @Inject(OutboundTenant) private readonly tenant: Pick<OutboundTenant, 'tenantId'>,
  ) {}

  async open(skuId: string, actor: WorkshopActor, tx?: DbTx): Promise<Workshop> {
    return this.db.run(async (trx) => {
      const [sku] = await trx
        .select({ id: skus.id })
        .from(skus)
        .where(and(eq(skus.id, skuId), eq(skus.isDeleted, false)));

      if (!sku) {
        throw new NotFoundError('SKU 를 찾을 수 없어요');
      }

      const tenantId = this.tenant.tenantId();

      if (!tenantId) {
        throw new TenantContextMissingError();
      }

      await trx
        .insert(sku3dWorkshops)
        .values({ tenantId, skuId, ownerId: actor.userId, ownerLabel: actor.label })
        .onConflictDoNothing({ target: [sku3dWorkshops.skuId, sku3dWorkshops.ownerId] });

      const [workshop] = await trx
        .select()
        .from(sku3dWorkshops)
        .where(and(eq(sku3dWorkshops.skuId, skuId), eq(sku3dWorkshops.ownerId, actor.userId)));

      return workshop;
    }, tx);
  }

  async confirmDimensions(
    workshopId: string,
    actor: WorkshopActor,
    basis: Sku3dDimensionBasis,
    tx?: DbTx,
  ): Promise<WorkshopJob | null> {
    return this.db.run(async (trx) => {
      const workshop = await this.loadForUpdate(trx, workshopId);

      assertOwner(workshop, actor);

      await trx
        .update(sku3dWorkshops)
        .set({
          dimensionBasis: basis,
          dimensionConfirmedAt: new Date(),
          dimensionConfirmedById: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(sku3dWorkshops.id, workshopId));

      const active = await this.activeJob(trx, workshopId);

      if (active) {
        return active;
      }

      if (await this.latestRevision(trx, workshopId)) {
        return null;
      }

      const [job] = await trx.insert(sku3dWorkshopJobs).values({ workshopId, kind: 'create' }).returning();

      await trx
        .insert(sku3dWorkshopEvents)
        .values({ workshopId, jobId: job.id, type: 'status', body: '제작을 요청했어요' });

      return job;
    }, tx);
  }

  async postMessage(workshopId: string, actor: WorkshopActor, body: string, tx?: DbTx): Promise<WorkshopJob> {
    return this.db.run(async (trx) => {
      const workshop = await this.loadForUpdate(trx, workshopId);

      assertOwner(workshop, actor);

      if (await this.activeJob(trx, workshopId)) {
        throw new ConflictError('지금 만들고 있어요. 끝나면 다시 보내 주세요');
      }

      const base = await this.latestRevision(trx, workshopId);

      if (!base) {
        throw new BadRequestError('아직 만든 모델이 없어요');
      }

      const [job] = await trx
        .insert(sku3dWorkshopJobs)
        .values({ workshopId, kind: 'revise', request: body, baseRevisionId: base.id })
        .returning();

      await trx.update(sku3dWorkshops).set({ updatedAt: new Date() }).where(eq(sku3dWorkshops.id, workshopId));

      await trx.insert(sku3dWorkshopEvents).values({
        workshopId,
        jobId: job.id,
        type: 'user_message',
        authorLabel: actor.label,
        body,
      });

      return job;
    }, tx);
  }

  // 작업실 행을 잠가 같은 작업실의 요청을 줄 세운다 — 부분 unique 인덱스는 마지막 방어선
  private async loadForUpdate(trx: DbTx, workshopId: string): Promise<Workshop> {
    const [workshop] = await trx.select().from(sku3dWorkshops).where(eq(sku3dWorkshops.id, workshopId)).for('update');

    if (!workshop) {
      throw new NotFoundError('3D 작업실을 찾을 수 없어요');
    }

    return workshop;
  }

  private async activeJob(trx: DbTx, workshopId: string): Promise<WorkshopJob | null> {
    const [job] = await trx
      .select()
      .from(sku3dWorkshopJobs)
      .where(
        and(eq(sku3dWorkshopJobs.workshopId, workshopId), inArray(sku3dWorkshopJobs.status, [...ACTIVE_STATUSES])),
      );

    return job ?? null;
  }

  private async latestRevision(trx: DbTx, workshopId: string) {
    const [revision] = await trx
      .select({ id: sku3dWorkshopRevisions.id })
      .from(sku3dWorkshopRevisions)
      .where(eq(sku3dWorkshopRevisions.workshopId, workshopId))
      .orderBy(desc(sku3dWorkshopRevisions.number))
      .limit(1);

    return revision ?? null;
  }
}
