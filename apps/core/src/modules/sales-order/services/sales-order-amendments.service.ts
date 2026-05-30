import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { eq, type InferInsertModel } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  CreateSalesOrderAmendmentDto,
  SalesOrderAmendmentDeltaDto,
  SalesOrderAmendmentDeltaType,
} from '../dto/create-sales-order-amendment.dto';

type BusinessLinkInsert = InferInsertModel<typeof wmsTables.businessLinks>;
type SalesOrderAmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;
type SalesOrderLineRow = typeof wmsTables.salesOrderLines.$inferSelect;

const AMENDMENT_REF_TYPE = 'sales_order_amendment';
const SALES_ORDER_REF_TYPE = 'sales_order';
const FULFILLMENT_ONLY_DELTA_TYPES = new Set<SalesOrderAmendmentDeltaType>(['fulfillment_only_correction']);
const FULFILLMENT_ONLY_FORBIDDEN_FIELDS: Array<keyof SalesOrderAmendmentDeltaDto> = [
  'replacementForLineId',
  'variantId',
  'productName',
  'quantity',
  'quantityDelta',
  'correctedQuantity',
  'unitPrice',
  'totalPrice',
  'amountDelta',
  'correctedAmount',
];

@Injectable()
export class SalesOrderAmendmentsService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async create(dto: CreateSalesOrderAmendmentDto, operatorId?: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [salesOrder] = await trx
        .select({ id: wmsTables.salesOrders.id, status: wmsTables.salesOrders.status })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, dto.salesOrderId))
        .limit(1);

      if (!salesOrder) {
        throw new NotFoundException(`Sales order ${dto.salesOrderId} not found`);
      }
      if (salesOrder.status === 'cancelled') {
        throw new BadRequestException('Cannot amend a cancelled SalesOrder');
      }

      const originalLines = await trx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, dto.salesOrderId));

      this.assertDeltasAreValid(dto, originalLines);

      const [amendment] = await trx
        .insert(wmsTables.salesOrderAmendments)
        .values({
          salesOrderId: dto.salesOrderId,
          amendmentKind: dto.amendmentKind,
          decision: dto.decision ?? 'approved',
          reasonCode: dto.reasonCode ?? null,
          note: dto.note ?? null,
          deltas: dto.deltas,
          metadata: dto.metadata ?? {},
          createdBy: operatorId ?? null,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        })
        .returning();

      const businessLink: BusinessLinkInsert = {
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: dto.salesOrderId,
        sourceExternalRef: null,
        targetType: AMENDMENT_REF_TYPE,
        targetId: amendment.id,
        targetExternalRef: null,
        relationName: 'opened_amendment',
        metadata: {
          amendmentKind: amendment.amendmentKind,
          decision: amendment.decision,
          deltaTypes: dto.deltas.map((delta) => delta.type),
        },
        occurredAt: amendment.occurredAt,
      };
      await trx.insert(wmsTables.businessLinks).values(businessLink);

      return this.toResponse(amendment);
    }, tx);
  }

  async getOne(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const [amendment] = await db
      .select()
      .from(wmsTables.salesOrderAmendments)
      .where(eq(wmsTables.salesOrderAmendments.id, id))
      .limit(1);
    if (!amendment) {
      throw new NotFoundException(`SalesOrderAmendment ${id} not found`);
    }
    return this.toResponse(amendment);
  }

  async listForSalesOrder(salesOrderId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const rows = await db
      .select()
      .from(wmsTables.salesOrderAmendments)
      .where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId));
    return rows.map((row) => this.toResponse(row));
  }

  private assertDeltasAreValid(dto: CreateSalesOrderAmendmentDto, originalLines: SalesOrderLineRow[]): void {
    const originalLineIds = new Set(originalLines.map((line) => line.id));

    if (dto.amendmentKind === 'fulfillment_only') {
      const commercialDelta = dto.deltas.find((delta) => !FULFILLMENT_ONLY_DELTA_TYPES.has(delta.type));
      if (commercialDelta) {
        throw new BadRequestException(`fulfillment_only amendments cannot include ${commercialDelta.type} deltas`);
      }
      const deltaWithCommercialFields = dto.deltas.find((delta) =>
        FULFILLMENT_ONLY_FORBIDDEN_FIELDS.some((field) => delta[field] !== undefined),
      );
      if (deltaWithCommercialFields) {
        const forbiddenFields = FULFILLMENT_ONLY_FORBIDDEN_FIELDS.filter(
          (field) => deltaWithCommercialFields[field] !== undefined,
        );
        throw new BadRequestException(
          `fulfillment_only amendments cannot include commercial fields: ${forbiddenFields.join(', ')}`,
        );
      }
    }

    for (const delta of dto.deltas) {
      this.assertDeltaShape(delta);

      const referencedLineIds = [delta.salesOrderLineId, delta.replacementForLineId].filter(
        (lineId): lineId is string => Boolean(lineId),
      );
      const missingLineId = referencedLineIds.find((lineId) => !originalLineIds.has(lineId));
      if (missingLineId) {
        throw new BadRequestException(`SalesOrder line ${missingLineId} does not belong to the target SalesOrder`);
      }
    }
  }

  private assertDeltaShape(delta: SalesOrderAmendmentDeltaDto): void {
    switch (delta.type) {
      case 'add_product':
        this.requireFields(delta, ['variantId', 'quantity']);
        return;
      case 'replace_product':
        this.requireFields(delta, ['replacementForLineId', 'variantId']);
        return;
      case 'quantity_correction':
        this.requireFields(delta, ['salesOrderLineId']);
        if (delta.quantityDelta === undefined && delta.correctedQuantity === undefined) {
          throw new BadRequestException('quantity_correction requires quantityDelta or correctedQuantity');
        }
        return;
      case 'amount_correction':
        if (delta.amountDelta === undefined && delta.correctedAmount === undefined) {
          throw new BadRequestException('amount_correction requires amountDelta or correctedAmount');
        }
        return;
      case 'fulfillment_only_correction':
        if (!delta.salesOrderLineId && !delta.fulfillmentInstruction) {
          throw new BadRequestException(
            'fulfillment_only_correction requires salesOrderLineId or fulfillmentInstruction',
          );
        }
        return;
      default:
        throw new BadRequestException(`Unsupported amendment delta type: ${(delta as { type?: string }).type}`);
    }
  }

  private requireFields(delta: SalesOrderAmendmentDeltaDto, fields: Array<keyof SalesOrderAmendmentDeltaDto>): void {
    const missing = fields.filter((field) => delta[field] === undefined || delta[field] === null);
    if (missing.length > 0) {
      throw new BadRequestException(`${delta.type} requires ${missing.join(', ')}`);
    }
  }

  private toResponse(amendment: SalesOrderAmendmentRow) {
    return {
      ...amendment,
      deltas: (amendment.deltas ?? []) as SalesOrderAmendmentDeltaDto[],
      metadata: (amendment.metadata ?? {}) as Record<string, unknown>,
    };
  }
}
