import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, desc, eq, ne, notInArray, sql, type InferInsertModel } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  CreateSalesOrderAmendmentDto,
  SalesOrderAmendmentDeltaDto,
  SalesOrderAmendmentDeltaType,
} from '../dto/create-sales-order-amendment.dto';
import { CHANNEL_ORDER_MODIFIED_REASON, type RecordedChannelDelta } from '../channel-order-change/channel-order-change.types';

type BusinessLinkInsert = InferInsertModel<typeof wmsTables.businessLinks>;
type SalesOrderAmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;
type SalesOrderLineRow = typeof wmsTables.salesOrderLines.$inferSelect;

const AMENDMENT_REF_TYPE = 'sales_order_amendment';
const SALES_ORDER_REF_TYPE = 'sales_order';
const FULFILLMENT_ONLY_DELTA_TYPES = new Set<SalesOrderAmendmentDeltaType>(['fulfillment_only_correction']);
export type AmendmentStatus = 'applied' | 'pending' | 'superseded' | 'dismissed' | 'requested' | 'rejected';
export type AmendmentOrigin = 'channel' | 'operator';
export interface AmendmentListItem {
  id: string;
  salesOrderId: string;
  salesChannel: string;
  channelOrderId: string;
  displayOrderNo: string | null;
  origin: AmendmentOrigin;
  status: AmendmentStatus;
  deltas: unknown[];
  occurredAt: Date;
  resyncRequestedAt: Date | null;
}
const HIDDEN_ORDER_STATUSES = ['cancelled', 'timeout'] as const;
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

  async create(dto: CreateSalesOrderAmendmentDto, operatorId?: string, tx?: DbTx) {
    return this.db.run(async (trx) => {
      const [salesOrder] = await trx
        .select({ id: wmsTables.salesOrders.id, status: wmsTables.salesOrders.status })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, dto.salesOrderId))
        .limit(1);

      if (!salesOrder) {
        throw new NotFoundError(`Sales order ${dto.salesOrderId} not found`);
      }
      if (salesOrder.status === 'cancelled') {
        throw new BadRequestError('Cannot amend a cancelled SalesOrder');
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
      throw new NotFoundError(`SalesOrderAmendment ${id} not found`);
    }
    return this.toResponse(amendment);
  }

  async listForSalesOrder(salesOrderId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const rows = await db
      .select()
      .from(wmsTables.salesOrderAmendments)
      .where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId))
      .orderBy(asc(wmsTables.salesOrderAmendments.occurredAt), asc(wmsTables.salesOrderAmendments.id));
    return rows.map((row) => this.toResponse(row));
  }

  private assertDeltasAreValid(dto: CreateSalesOrderAmendmentDto, originalLines: SalesOrderLineRow[]): void {
    const originalLineIds = new Set(originalLines.map((line) => line.id));

    if (dto.amendmentKind === 'fulfillment_only') {
      const commercialDelta = dto.deltas.find((delta) => !FULFILLMENT_ONLY_DELTA_TYPES.has(delta.type));
      if (commercialDelta) {
        throw new BadRequestError(`fulfillment_only amendments cannot include ${commercialDelta.type} deltas`);
      }
      const deltaWithCommercialFields = dto.deltas.find((delta) =>
        FULFILLMENT_ONLY_FORBIDDEN_FIELDS.some((field) => delta[field] !== undefined),
      );
      if (deltaWithCommercialFields) {
        const forbiddenFields = FULFILLMENT_ONLY_FORBIDDEN_FIELDS.filter(
          (field) => deltaWithCommercialFields[field] !== undefined,
        );
        throw new BadRequestError(
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
        throw new BadRequestError(`SalesOrder line ${missingLineId} does not belong to the target SalesOrder`);
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
          throw new BadRequestError('quantity_correction requires quantityDelta or correctedQuantity');
        }
        return;
      case 'amount_correction':
        if (delta.amountDelta === undefined && delta.correctedAmount === undefined) {
          throw new BadRequestError('amount_correction requires amountDelta or correctedAmount');
        }
        return;
      case 'fulfillment_only_correction':
        if (!delta.salesOrderLineId && !delta.fulfillmentInstruction) {
          throw new BadRequestError(
            'fulfillment_only_correction requires salesOrderLineId or fulfillmentInstruction',
          );
        }
        return;
      default:
        throw new BadRequestError(`Unsupported amendment delta type: ${(delta as { type?: string }).type}`);
    }
  }

  private requireFields(delta: SalesOrderAmendmentDeltaDto, fields: Array<keyof SalesOrderAmendmentDeltaDto>): void {
    const missing = fields.filter((field) => delta[field] === undefined || delta[field] === null);
    if (missing.length > 0) {
      throw new BadRequestError(`${delta.type} requires ${missing.join(', ')}`);
    }
  }

  /**
   * 채널 변경 한 건 = 한 행 (#1016 판단 6). 같은 판매주문의 이전 채널 pending 은 superseded —
   * diff 가 매번 판매주문과 새로 비교하므로 최신 행이 남은 차이를 전부 담는다. 델타가 비면 행을 쓰지 않는다.
   */
  async recordChannelAmendment(
    input: {
      id: string;
      salesOrderId: string;
      deltas: RecordedChannelDelta[];
      occurredAt: Date;
      sourceEventId: string;
      salesChannel: string;
      externalOrderId: string;
    },
    tx: DbTx,
  ): Promise<void> {
    const table = wmsTables.salesOrderAmendments;
    if (input.deltas.length > 0) {
      const pending = input.deltas.some((delta) => delta.outcome === 'pending');
      const [amendment] = await tx
        .insert(table)
        .values({
          id: input.id,
          salesOrderId: input.salesOrderId,
          amendmentKind: input.deltas.every((delta) => delta.type === 'shipping_address_change') ? 'fulfillment_only' : 'commercial',
          reasonCode: CHANNEL_ORDER_MODIFIED_REASON,
          deltas: input.deltas,
          metadata: { salesChannel: input.salesChannel, externalOrderId: input.externalOrderId },
          createdBy: null,
          occurredAt: input.occurredAt,
          origin: 'channel',
          status: pending ? 'pending' : 'applied',
          sourceEventId: input.sourceEventId,
        })
        .returning();
      await tx.insert(wmsTables.businessLinks).values({
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: input.salesOrderId,
        sourceExternalRef: null,
        targetType: AMENDMENT_REF_TYPE,
        targetId: amendment.id,
        targetExternalRef: null,
        relationName: 'opened_amendment',
        metadata: { amendmentKind: amendment.amendmentKind, origin: 'channel', status: amendment.status, deltaTypes: input.deltas.map((delta) => delta.type) },
        occurredAt: amendment.occurredAt,
      });
    }
    await tx
      .update(table)
      .set({ status: 'superseded', supersededById: input.deltas.length > 0 ? input.id : null, updatedAt: new Date() })
      .where(
        and(
          eq(table.salesOrderId, input.salesOrderId),
          eq(table.origin, 'channel'),
          eq(table.status, 'pending'),
          ne(table.id, input.id),
        ),
      );
  }

  /** 대기 목록(#1016 5번 행 화면). 끝난 판매주문의 행은 뺀다 — Medusa 취소 직전 스냅샷이 남긴 pending 이 거기 남는다. */
  async list(
    query: { status?: AmendmentStatus; origin?: AmendmentOrigin; limit: number; cursor?: string },
    tx?: DbTx,
  ): Promise<{ items: AmendmentListItem[]; nextCursor: string | null }> {
    const db = tx ?? this.db.db;
    const table = wmsTables.salesOrderAmendments;
    const orders = wmsTables.salesOrders;
    // 정렬·커서 키를 밀리초로 맞춘다 — ISO 왕복이 µs 를 자르므로 같은 키를 양쪽에 쓴다.
    const occurredMs = sql`date_trunc('milliseconds', ${table.occurredAt})`;
    let after: ReturnType<typeof sql> | undefined;
    if (query.cursor) {
      const sep = query.cursor.lastIndexOf('|');
      const cursorDate = new Date(query.cursor.slice(0, sep));
      if (sep < 0 || Number.isNaN(cursorDate.getTime())) throw new BadRequestError('Invalid cursor');
      after = sql`(${occurredMs}, ${table.id}) < (${cursorDate.toISOString()}::timestamptz, ${query.cursor.slice(sep + 1)}::uuid)`;
    }
    const rows = await db
      .select({
        id: table.id,
        salesOrderId: table.salesOrderId,
        salesChannel: orders.salesChannel,
        channelOrderId: orders.channelOrderId,
        displayOrderNo: orders.displayOrderNo,
        origin: table.origin,
        status: table.status,
        deltas: table.deltas,
        occurredAt: table.occurredAt,
        resyncRequestedAt: table.resyncRequestedAt,
      })
      .from(table)
      .innerJoin(orders, eq(orders.id, table.salesOrderId))
      .where(
        and(
          query.status ? eq(table.status, query.status) : undefined,
          query.origin ? eq(table.origin, query.origin) : undefined,
          after,
          notInArray(orders.status, [...HIDDEN_ORDER_STATUSES]),
        ),
      )
      .orderBy(desc(occurredMs), desc(table.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({ ...row, deltas: Array.isArray(row.deltas) ? row.deltas : [] })),
      nextCursor: rows.length > query.limit ? `${page[page.length - 1].occurredAt.toISOString()}|${page[page.length - 1].id}` : null,
    };
  }

  private toResponse(amendment: SalesOrderAmendmentRow) {
    return {
      ...amendment,
      // jsonb 의 모양은 쓰는 쪽이 보장한다 — 운영자 행은 DTO 검증, 채널 행은 RecordedChannelDelta(recordChannelAmendment).
      deltas: (amendment.deltas ?? []) as SalesOrderAmendmentDeltaDto[],
      metadata: (amendment.metadata ?? {}) as Record<string, unknown>,
    };
  }
}
