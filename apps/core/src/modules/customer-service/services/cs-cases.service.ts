import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { and, desc, eq, inArray, or, type InferInsertModel } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { BusinessLinkReferenceDto, CreateBusinessLinkDto } from '../../sales-order/dto/create-business-link.dto';
import {
  csCaseCommentAttachments,
  csCaseCommentMentions,
  csCaseComments,
  csCaseEvents,
  csCaseLabels,
  csCases,
  type CsCase,
  type CsCaseEventType,
} from '../schema/customer-service.schema';
import { CreateCsCaseDto } from '../dto/create-cs-case.dto';

type Db = DbService<MergedSchema>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type BusinessLinkInsert = InferInsertModel<typeof wmsTables.businessLinks>;
type BusinessLinkRow = typeof wmsTables.businessLinks.$inferSelect;
type CsCaseCommentRow = typeof csCaseComments.$inferSelect;
type CsCaseCommentMentionRow = typeof csCaseCommentMentions.$inferSelect;
type CsCaseCommentAttachmentRow = typeof csCaseCommentAttachments.$inferSelect;
type CsCaseEventRow = typeof csCaseEvents.$inferSelect;
type BusinessLinkReference = {
  type: string;
  id: string | null;
  externalRef: string | null;
};

const CS_CASE_REF_TYPE = 'cs_case';

@Injectable()
export class CsCasesService {
  constructor(@InjectDb() private readonly dbService: DbService<MergedSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /** Append an immutable system event row. NOT a Kafka event. */
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

  private async loadCaseOrThrow(id: string, tx: Tx): Promise<CsCase> {
    const [csCase] = await tx.select().from(csCases).where(eq(csCases.id, id)).limit(1);
    if (!csCase) {
      throw new NotFoundError(`CS Case ${id} not found`);
    }
    return csCase;
  }

  async create(dto: CreateCsCaseDto, operatorId?: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const [created] = await trx
        .insert(csCases)
        .values({
          subject: dto.subject,
          description: dto.description ?? null,
          priority: dto.priority ?? 'normal',
          sourceChannel: dto.sourceChannel ?? 'kakao',
          externalThreadRef: dto.externalThreadRef ?? null,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName ?? null,
          assignedTo: dto.assignedTo ?? null,
          metadata: dto.metadata ?? {},
          createdBy: operatorId ?? null,
        })
        .returning();

      return this.toCaseResponse(created, [], []);
    }, tx);
  }

  async getOne(id: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const csCase = await this.loadCaseOrThrow(id, trx);

      const comments = await trx.select().from(csCaseComments).where(eq(csCaseComments.csCaseId, id));
      const commentIds = comments.map((c) => c.id);
      const mentions = commentIds.length
        ? await trx.select().from(csCaseCommentMentions).where(inArray(csCaseCommentMentions.commentId, commentIds))
        : [];
      const attachments = commentIds.length
        ? await trx
            .select()
            .from(csCaseCommentAttachments)
            .where(inArray(csCaseCommentAttachments.commentId, commentIds))
        : [];
      const events = await trx.select().from(csCaseEvents).where(eq(csCaseEvents.csCaseId, id));
      const links = await trx
        .select()
        .from(wmsTables.businessLinks)
        .where(
          or(
            and(eq(wmsTables.businessLinks.sourceType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.sourceId, id)),
            and(eq(wmsTables.businessLinks.targetType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.targetId, id)),
          ),
        );
      const caseLabels = await trx.select().from(csCaseLabels).where(eq(csCaseLabels.csCaseId, id));

      const timeline = this.buildTimeline(id, comments, mentions, attachments, events, links);
      return this.toCaseResponse(
        csCase,
        caseLabels.map((l) => l.labelId),
        timeline,
      );
    }, tx);
  }

  async updateStatus(id: string, status: CsCase['status'], operatorId?: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const current = await this.loadCaseOrThrow(id, trx);
      const previousStatus = current.status;
      if (previousStatus === status) {
        return this.toCaseResponse(current, [], []);
      }

      const [updated] = await trx
        .update(csCases)
        .set({
          status,
          closedAt: status === 'closed' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(csCases.id, id))
        .returning();

      await this.recordEvent(trx, id, 'status_changed', operatorId, { from: previousStatus, to: status });
      return this.toCaseResponse(updated, [], []);
    }, tx);
  }

  async assign(id: string, assigneeId: string | null, operatorId?: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const current = await this.loadCaseOrThrow(id, trx);
      const previousAssignedTo = current.assignedTo ?? null;
      if (previousAssignedTo === (assigneeId ?? null)) {
        throw new BadRequestError(
          assigneeId ? `CS Case ${id} is already assigned to ${assigneeId}` : `CS Case ${id} is already unassigned`,
        );
      }

      const [updated] = await trx
        .update(csCases)
        .set({ assignedTo: assigneeId, updatedAt: new Date() })
        .where(eq(csCases.id, id))
        .returning();

      if (assigneeId) {
        await this.recordEvent(trx, id, 'assigned', operatorId, { from: previousAssignedTo, to: assigneeId });
      } else {
        await this.recordEvent(trx, id, 'unassigned', operatorId, { from: previousAssignedTo });
      }
      return this.toCaseResponse(updated, [], []);
    }, tx);
  }

  async createBusinessLink(id: string, dto: CreateBusinessLinkDto, tx?: Tx) {
    return this.inTx(async (trx) => {
      await this.loadCaseOrThrow(id, trx);
      if (!dto.target) {
        throw new BadRequestError('Business link target is required');
      }

      const source = this.normalizeBusinessLinkRef(dto.source ?? { type: CS_CASE_REF_TYPE, id });
      const target = this.normalizeBusinessLinkRef(dto.target);

      if (!this.hasBusinessLinkRef(source)) {
        throw new BadRequestError('Business link source must include id or externalRef');
      }
      if (!this.hasBusinessLinkRef(target)) {
        throw new BadRequestError('Business link target must include id or externalRef');
      }
      if (!this.referencesCsCase(source, id) && !this.referencesCsCase(target, id)) {
        throw new BadRequestError('Business link must reference the requested CS Case as source or target');
      }

      await this.assertSalesOrderReferenceExists(source, trx);
      await this.assertSalesOrderReferenceExists(target, trx);

      const values: BusinessLinkInsert = {
        sourceType: source.type,
        sourceId: source.id,
        sourceExternalRef: source.externalRef,
        targetType: target.type,
        targetId: target.id,
        targetExternalRef: target.externalRef,
        relationName: dto.relationName,
        metadata: dto.metadata ?? {},
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      };

      const [businessLink] = await trx.insert(wmsTables.businessLinks).values(values).returning();
      return this.toBusinessTimelineItem(id, businessLink);
    }, tx);
  }

  async list(limit = 20, tx?: Tx) {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select()
        .from(csCases)
        .orderBy(desc(csCases.createdAt))
        .limit(Math.min(100, Math.max(1, limit)));
      return rows.map((row) => this.toCaseResponse(row, [], []));
    }, tx);
  }

  private async assertSalesOrderReferenceExists(ref: BusinessLinkReference, tx: Tx): Promise<void> {
    if (ref.type !== 'sales_order' || !ref.id) {
      return;
    }
    const [order] = await tx
      .select({ id: wmsTables.salesOrders.id })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, ref.id))
      .limit(1);
    if (!order) {
      throw new NotFoundError(`Sales order ${ref.id} not found`);
    }
  }

  private normalizeBusinessLinkRef(ref: BusinessLinkReferenceDto): BusinessLinkReference {
    return {
      type: ref.type,
      id: ref.id ?? null,
      externalRef: ref.externalRef ?? null,
    };
  }

  private hasBusinessLinkRef(ref: BusinessLinkReference): boolean {
    return Boolean(ref.id || ref.externalRef);
  }

  private referencesCsCase(ref: BusinessLinkReference, csCaseId: string): boolean {
    return ref.type === CS_CASE_REF_TYPE && ref.id === csCaseId;
  }

  private buildTimeline(
    csCaseId: string,
    comments: CsCaseCommentRow[],
    mentions: CsCaseCommentMentionRow[],
    attachments: CsCaseCommentAttachmentRow[],
    events: CsCaseEventRow[],
    links: BusinessLinkRow[],
  ) {
    const commentItems = comments.map((c) => ({
      kind: 'comment' as const,
      id: c.id,
      occurredAt: c.createdAt,
      actorId: c.authorId ?? null,
      body: c.deletedAt ? null : c.body,
      deleted: Boolean(c.deletedAt),
      edited: Boolean(c.editedAt),
      mentions: mentions.filter((m) => m.commentId === c.id).map((m) => m.mentionedUserId),
      attachmentFileIds: attachments.filter((a) => a.commentId === c.id).map((a) => a.fileId),
    }));

    const eventItems = events.map((e) => ({
      kind: 'event' as const,
      id: e.id,
      occurredAt: e.occurredAt,
      actorId: e.actorId ?? null,
      eventType: e.type,
      payload: (e.payload ?? {}) as Record<string, unknown>,
    }));

    const linkItems = links.map((link) => {
      const outbound = link.sourceType === CS_CASE_REF_TYPE && link.sourceId === csCaseId;
      return {
        kind: 'business_link' as const,
        id: link.id,
        occurredAt: link.occurredAt,
        actorId: null,
        payload: {
          relationName: link.relationName,
          direction: outbound ? 'outbound' : 'inbound',
          linkedEntity: outbound
            ? { type: link.targetType, id: link.targetId, externalRef: link.targetExternalRef }
            : { type: link.sourceType, id: link.sourceId, externalRef: link.sourceExternalRef },
        } as Record<string, unknown>,
      };
    });

    return [...commentItems, ...eventItems, ...linkItems].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
  }

  private toCaseResponse(csCase: CsCase, labelIds: string[], timeline: unknown[]) {
    return {
      ...csCase,
      metadata: (csCase.metadata ?? {}) as Record<string, unknown>,
      labelIds,
      timeline,
    };
  }

  private toBusinessTimeline(csCaseId: string, links: BusinessLinkRow[]) {
    return links
      .map((link) => this.toBusinessTimelineItem(csCaseId, link))
      .sort((a, b) => {
        const occurred = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (occurred !== 0) return occurred;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  private toBusinessTimelineItem(csCaseId: string, link: BusinessLinkRow) {
    const source = this.toBusinessLinkRef(link.sourceType, link.sourceId, link.sourceExternalRef);
    const target = this.toBusinessLinkRef(link.targetType, link.targetId, link.targetExternalRef);
    const direction = this.referencesCsCase(source, csCaseId) ? 'outbound' : 'inbound';

    return {
      id: link.id,
      relationName: link.relationName,
      direction,
      source,
      target,
      linkedEntity: direction === 'outbound' ? target : source,
      metadata: (link.metadata ?? {}) as Record<string, unknown>,
      occurredAt: link.occurredAt,
      createdAt: link.createdAt,
    };
  }

  private toBusinessLinkRef(type: string, id: string | null, externalRef: string | null): BusinessLinkReference {
    return { type, id, externalRef };
  }
}
