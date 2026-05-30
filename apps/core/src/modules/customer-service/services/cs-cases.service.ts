import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, desc, eq, or, type InferInsertModel } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { BusinessLinkReferenceDto, CreateBusinessLinkDto } from '../../sales-order/dto/create-business-link.dto';
import { csCases, type CsCase } from '../schema/customer-service.schema';
import { CreateCsCaseDto } from '../dto/create-cs-case.dto';

type Db = DbService<MergedSchema>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type BusinessLinkInsert = InferInsertModel<typeof wmsTables.businessLinks>;
type BusinessLinkRow = typeof wmsTables.businessLinks.$inferSelect;
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

  async create(dto: CreateCsCaseDto, operatorId?: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const [created] = await trx
        .insert(csCases)
        .values({
          subject: dto.subject,
          reasonCode: dto.reasonCode ?? null,
          description: dto.description ?? null,
          priority: dto.priority ?? 'normal',
          customerId: dto.customerId ?? null,
          customerName: dto.customerName ?? null,
          customerEmail: dto.customerEmail ?? null,
          customerPhone: dto.customerPhone ?? null,
          assignedTo: dto.assignedTo ?? null,
          metadata: dto.metadata ?? {},
          createdBy: operatorId ?? null,
        })
        .returning();

      return this.toCaseResponse(created, []);
    }, tx);
  }

  async getOne(id: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const csCase = await this.loadCaseOrThrow(id, trx);
      const links = await trx
        .select()
        .from(wmsTables.businessLinks)
        .where(
          or(
            and(eq(wmsTables.businessLinks.sourceType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.sourceId, id)),
            and(eq(wmsTables.businessLinks.targetType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.targetId, id)),
          ),
        );

      return this.toCaseResponse(csCase, this.toBusinessTimeline(id, links));
    }, tx);
  }

  async createBusinessLink(id: string, dto: CreateBusinessLinkDto, tx?: Tx) {
    return this.inTx(async (trx) => {
      await this.loadCaseOrThrow(id, trx);
      if (!dto.target) {
        throw new BadRequestException('Business link target is required');
      }

      const source = this.normalizeBusinessLinkRef(dto.source ?? { type: CS_CASE_REF_TYPE, id });
      const target = this.normalizeBusinessLinkRef(dto.target);

      if (!this.hasBusinessLinkRef(source)) {
        throw new BadRequestException('Business link source must include id or externalRef');
      }
      if (!this.hasBusinessLinkRef(target)) {
        throw new BadRequestException('Business link target must include id or externalRef');
      }
      if (!this.referencesCsCase(source, id) && !this.referencesCsCase(target, id)) {
        throw new BadRequestException('Business link must reference the requested CS Case as source or target');
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
      return rows.map((row) => this.toCaseResponse(row, []));
    }, tx);
  }

  private async loadCaseOrThrow(id: string, tx: Tx): Promise<CsCase> {
    const [csCase] = await tx.select().from(csCases).where(eq(csCases.id, id)).limit(1);
    if (!csCase) {
      throw new NotFoundException(`CS Case ${id} not found`);
    }
    return csCase;
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
      throw new NotFoundException(`Sales order ${ref.id} not found`);
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

  private toCaseResponse(csCase: CsCase, businessTimeline: ReturnType<CsCasesService['toBusinessTimeline']>) {
    return {
      ...csCase,
      metadata: (csCase.metadata ?? {}) as Record<string, unknown>,
      businessTimeline,
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
