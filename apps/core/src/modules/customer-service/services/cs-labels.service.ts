import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { ConflictError, NotFoundError } from '@app/shared';
import { and, asc, eq } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import { CreateCsLabelDto } from '../dto/cs-label.dto';
import {
  csCaseEvents,
  csCaseLabels,
  csCases,
  csLabels,
  type CsCaseEventType,
} from '../schema/customer-service.schema';

type Db = DbService<MergedSchema>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class CsLabelsService {
  constructor(@InjectDb() private readonly dbService: DbService<MergedSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  private async recordEvent(
    tx: Tx,
    csCaseId: string,
    type: CsCaseEventType,
    actorId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(csCaseEvents).values({
      csCaseId,
      type,
      actorId: actorId ?? null,
      payload,
    });
  }

  async listLabels(tx?: Tx) {
    return this.inTx((trx) => trx.select().from(csLabels).orderBy(asc(csLabels.sortOrder)).limit(500), tx);
  }

  async createLabel(dto: CreateCsLabelDto, tx?: Tx) {
    return this.inTx(async (trx) => {
      const [existing] = await trx.select().from(csLabels).where(eq(csLabels.name, dto.name)).limit(1);
      if (existing) throw new ConflictError(`Label "${dto.name}" already exists`);

      const [label] = await trx
        .insert(csLabels)
        .values({
          name: dto.name,
          color: dto.color ?? '#888888',
          isActive: true,
          sortOrder: dto.sortOrder ?? 0,
        })
        .returning();
      return label;
    }, tx);
  }

  async applyLabel(csCaseId: string, labelId: string, actorId: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      await this.loadCaseOrThrow(csCaseId, trx);
      const label = await this.loadActiveLabelOrThrow(labelId, trx);

      const [applied] = await trx
        .insert(csCaseLabels)
        .values({ csCaseId, labelId })
        .onConflictDoNothing({ target: [csCaseLabels.csCaseId, csCaseLabels.labelId] })
        .returning();
      if (!applied) {
        const [existing] = await trx
          .select()
          .from(csCaseLabels)
          .where(and(eq(csCaseLabels.csCaseId, csCaseId), eq(csCaseLabels.labelId, labelId)))
          .limit(1);
        return existing;
      }

      await this.recordEvent(trx, csCaseId, 'label_added', actorId, { labelId, labelName: label.name });
      return applied;
    }, tx);
  }

  async removeLabel(csCaseId: string, labelId: string, actorId: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      await this.loadCaseOrThrow(csCaseId, trx);
      const label = await this.loadLabelOrThrow(labelId, trx);

      const [removed] = await trx
        .delete(csCaseLabels)
        .where(and(eq(csCaseLabels.csCaseId, csCaseId), eq(csCaseLabels.labelId, labelId)))
        .returning();
      if (!removed) return undefined;

      await this.recordEvent(trx, csCaseId, 'label_removed', actorId, { labelId, labelName: label.name });
      return removed;
    }, tx);
  }

  private async loadCaseOrThrow(csCaseId: string, tx: Tx) {
    const [csCase] = await tx.select().from(csCases).where(eq(csCases.id, csCaseId)).limit(1);
    if (!csCase) throw new NotFoundError(`CS Case ${csCaseId} not found`);
    return csCase;
  }

  private async loadLabelOrThrow(labelId: string, tx: Tx) {
    const [label] = await tx.select().from(csLabels).where(eq(csLabels.id, labelId)).limit(1);
    if (!label) throw new NotFoundError(`CS label ${labelId} not found`);
    return label;
  }

  private async loadActiveLabelOrThrow(labelId: string, tx: Tx) {
    const label = await this.loadLabelOrThrow(labelId, tx);
    if (!label.isActive) throw new NotFoundError(`CS label ${labelId} not found`);
    return label;
  }
}
