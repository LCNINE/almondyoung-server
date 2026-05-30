import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, inArray, desc, and, or, gte, lte, count, sql, type InferInsertModel, type SQL } from 'drizzle-orm';
import { PoliciesService } from './policies.service';
import { OutboxService } from '../../inventory/shared/outbox/outbox.service';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { MetricsService } from '../../inventory/shared/services/metrics.service';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { FulfillmentOrderCreationBacklogService } from '../../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { LibraryService } from '../../library/services/library.service';
import { ORDER_EVENTS } from '../common/events';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { MergeSalesOrdersDto } from '../dto/merge-sales-orders.dto';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { BusinessLinkReferenceDto, CreateBusinessLinkDto } from '../dto/create-business-link.dto';
import { CancelSalesOrderDto } from '../dto/cancel-sales-order.dto';
import { AddressDto } from '../dto/address.dto';
import { OrderCreatedPayload, OrderModifiedPayload, ShippingAddress, OrderItem } from '@packages/event-contracts';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';

type SalesOrderLineInsert = InferInsertModel<typeof wmsTables.salesOrderLines>;
type BusinessLinkInsert = InferInsertModel<typeof wmsTables.businessLinks>;
type SalesOrderCancellationInsert = InferInsertModel<typeof wmsTables.salesOrderCancellations>;
type BusinessLinkRow = typeof wmsTables.businessLinks.$inferSelect;
type WmsDb = DbService<typeof wmsSchema>['db'];
type BusinessLinkReference = {
  type: string;
  id: string | null;
  externalRef: string | null;
};
type SalesOrderTimelineContext = {
  salesOrderId: string;
  cancellationIds: Set<string>;
  amendmentIds: Set<string>;
  csCaseIds: Set<string>;
};
type TimelineEffectStatus = {
  owner: string;
  value: string;
};
type SalesOrderContractField =
  | 'customer'
  | 'customerId'
  | 'shippingAddress'
  | 'totalAmount'
  | 'shippingFee'
  | 'items'
  | 'lines';
type SalesOrderPatchInput = UpdateSalesOrderDto & Partial<Record<SalesOrderContractField, unknown>>;
type CancelSalesOrderOptions = CancelSalesOrderDto;
type CancellationEffect = {
  type: string;
  targetType?: string;
  targetId?: string;
  targetExternalRef?: string;
  count?: number;
  metadata?: Record<string, unknown>;
};

const ACCEPTED_CONTRACT_CHANNELS = new Set(['medusa', 'naver', 'coupang']);
const CONTRACT_PATCH_FIELDS: SalesOrderContractField[] = [
  'customer',
  'customerId',
  'shippingAddress',
  'totalAmount',
  'shippingFee',
  'items',
  'lines',
];
const SALES_ORDER_REF_TYPE = 'sales_order';
const ORDER_CANCELLATION_REF_TYPE = 'order_cancellation';
const SALES_ORDER_AMENDMENT_REF_TYPE = 'sales_order_amendment';
const CS_CASE_REF_TYPE = 'cs_case';
const WALLET_EFFECT_REF_TYPES = new Set([
  'wallet_refund',
  'wallet_payment_effect',
  'wallet_payment_intent',
  'wallet_charge',
]);
const CANCELLABLE_FULFILLMENT_STATUSES = new Set([
  'created',
  'reserving',
  'ready',
  'unfulfillable',
  'labeled',
  'pending',
  'allocated',
  'picking',
  'picked',
  'inspecting',
  'invoiced',
]);

/** Phase 6에서 FulfillmentsService로 교체된다 */
interface IFulfillmentsService {
  create(
    dto: { salesOrderId: string; warehouseId?: string; shippingAddress: any; lines: any[] },
    tx?: DbTx,
  ): Promise<any>;
}

@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly policies: PoliciesService,
    private readonly outbox: OutboxService,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly productSkuMapping: ProductSkuMappingService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
    private readonly fulfillmentBacklog: FulfillmentOrderCreationBacklogService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly fulfillments?: IFulfillmentsService,
    @Optional() private readonly library?: LibraryService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async create(dto: CreateSalesOrderDto, tx?: DbTx) {
    const timer = this.metrics?.startOrderTimer('create');

    return this.inTx(async (trx) => {
      const [order] = await trx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: dto.channelOrderId,
          salesChannel: dto.salesChannel as 'naver' | 'medusa' | 'coupang' | '3pl',
          status: 'pending' as const,
          customerId: dto.customer?.id ?? null,
          customerName: dto.customer?.name ?? null,
          customerEmail: dto.customer?.email ?? null,
          customerPhone: dto.customer?.phone ?? null,
          shippingAddress: dto.shippingAddress as any,
          shippingAddressHash: dto.shippingAddressHash ?? null,
          totalAmount: dto.totalAmount ?? null,
          shippingFee: dto.shippingFee ?? 0,
          mergeGroupId: dto.mergeGroupId ?? null,
          isMerged: false,
          orderDate: new Date(dto.orderDate ?? Date.now()),
          confirmedAt: null,
          processedAt: null,
        })
        .returning();

      await this.outbox.enqueue(
        {
          eventType: ORDER_EVENTS.CREATED,
          aggregateType: 'order',
          aggregateId: order.id,
          partitionKey: order.id,
          payload: { orderId: order.id },
        },
        trx,
      );

      const lines = Array.isArray(dto.lines) ? dto.lines : [];
      if (lines.length > 0) {
        const values: SalesOrderLineInsert[] = [];
        for (const l of lines) {
          const policy = await this.policies.getVariantPolicy(l.variantId, trx);
          const acceptanceByPolicy =
            !policy.inventoryManagement || policy.preStockSellable || policy.alwaysSellableZeroStock;
          values.push({
            salesOrderId: order.id,
            variantId: l.variantId,
            productMatchingId: l.productMatchingId ?? null,
            productName: l.productName ?? '',
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? null,
            totalPrice: l.totalPrice ?? null,
            status: 'pending',
            suggestedQuantity: acceptanceByPolicy ? l.quantity : null,
            unavailableSkuIds: null,
            deductedAt: null,
          });
        }
        await trx.insert(wmsTables.salesOrderLines).values(values);
      }

      await this.audit?.logResourceChange(
        'ORDER_CREATED',
        'create',
        'order',
        'salesOrder',
        order.id,
        `Sales Order ${dto.channelOrderId || order.id}`,
        undefined,
        {
          channelOrderId: order.channelOrderId,
          salesChannel: order.salesChannel,
          customerName: order.customerName,
          totalAmount: order.totalAmount,
          lineCount: lines.length,
        },
        undefined,
        trx,
      );

      timer?.();
      this.metrics?.incrementOrderCounter('created', order.salesChannel || 'unknown');
      this.metrics?.incrementBusinessOperation('order', 'create', 'success');

      return order;
    }, tx).catch((error) => {
      timer?.();
      this.metrics?.incrementErrorCounter('order', 'create_failed', 'high');
      this.metrics?.incrementBusinessOperation('order', 'create', 'failure');
      throw error;
    });
  }

  async update(id: string, dto: UpdateSalesOrderDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [salesOrder] = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1);
      if (!salesOrder) {
        throw new NotFoundException(`Sales order ${id} not found`);
      }

      this.assertAcceptedContractIsNotPatched(salesOrder, dto);

      const updateData: Record<string, unknown> = {};

      if (dto.customer) {
        if ('name' in dto.customer) updateData.customerName = dto.customer.name ?? null;
        if ('email' in dto.customer) updateData.customerEmail = dto.customer.email ?? null;
        if ('phone' in dto.customer) updateData.customerPhone = dto.customer.phone ?? null;
      }
      if (dto.shippingAddress !== undefined) updateData.shippingAddress = dto.shippingAddress;
      if (dto.totalAmount !== undefined) updateData.totalAmount = dto.totalAmount;
      if (dto.shippingFee !== undefined) updateData.shippingFee = dto.shippingFee;
      if (dto.processedAt !== undefined) updateData.processedAt = dto.processedAt ? new Date(dto.processedAt) : null;
      if (dto.memo !== undefined) updateData.memo = dto.memo;

      if (Object.keys(updateData).length > 0) {
        await trx
          .update(wmsTables.salesOrders)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(wmsTables.salesOrders.id, id));

        await this.outbox.enqueue(
          {
            eventType: ORDER_EVENTS.MODIFIED,
            aggregateType: 'order',
            aggregateId: id,
            partitionKey: id,
            payload: { orderId: id },
          },
          trx,
        );
      }

      const updated = await this.getOne(id, trx);
      return updated;
    }, tx);
  }

  async confirm(id: string, warehouseId?: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const lines = await trx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, id));

      if (warehouseId && lines.length > 0) {
        for (const line of lines) {
          const snapshotId = await this.productSkuMapping.createSnapshotForVariant(line.variantId, warehouseId, trx);
          if (snapshotId) {
            await trx
              .update(wmsTables.salesOrderLines)
              .set({ mappingSnapshotId: snapshotId })
              .where(eq(wmsTables.salesOrderLines.id, line.id));
          } else {
            this.logger.warn(`No mapping found for variantId=${line.variantId} in warehouseId=${warehouseId}`);
          }
        }
      }

      await trx
        .update(wmsTables.salesOrders)
        .set({ status: 'confirmed', confirmedAt: new Date() })
        .where(eq(wmsTables.salesOrders.id, id));

      const updated = await this.getOne(id, trx);

      return updated;
    }, tx);
  }

  async cancel(id: string, optionsOrTx?: CancelSalesOrderOptions | DbTx, tx?: DbTx) {
    const { options, tx: explicitTx } = this.normalizeCancelArgs(optionsOrTx, tx);

    return this.inTx(async (trx) => {
      this.logger.log(`Cancelling sales order: ${id}`);

      await trx.execute(sql`
        SELECT id
        FROM ${wmsTables.salesOrders}
        WHERE ${wmsTables.salesOrders.id} = ${id}
        FOR UPDATE
      `);

      const salesOrder = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1)
        .then((r) => r[0]);

      if (!salesOrder) throw new NotFoundException(`Sales order ${id} not found`);

      const existingCancellation = await trx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(
          and(
            eq(wmsTables.salesOrderCancellations.salesOrderId, id),
            eq(wmsTables.salesOrderCancellations.cancellationScope, 'full'),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (existingCancellation) {
        this.logger.warn(`Sales order ${id} already has full cancellation ${existingCancellation.id}`);
        if (salesOrder.status !== 'cancelled') {
          await trx
            .update(wmsTables.salesOrders)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(eq(wmsTables.salesOrders.id, id));
        }
        await this.closeOpenFulfillmentBacklogEffects(id, trx);
        return this.getOne(id, trx);
      }

      const originalLines = await trx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, id));

      const fulfillmentOrders = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, id));

      this.logger.log(`Found ${fulfillmentOrders.length} fulfillment orders for SO ${id}`);

      const effects: CancellationEffect[] = [];
      const cancelledFulfillmentOrderIds: string[] = [];

      for (const fo of fulfillmentOrders) {
        if (!CANCELLABLE_FULFILLMENT_STATUSES.has(fo.status)) continue;

        try {
          await this.reservationLifecycle.handleFulfillmentOrderStatusChange(fo.id, fo.status, 'canceled', trx);
        } catch (error) {
          this.logger.error(`Failed to release reservations for FO ${fo.id}:`, error);
        }

        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
          .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

        cancelledFulfillmentOrderIds.push(fo.id);
        effects.push({
          type: 'cancelled_fulfillment_order',
          targetType: 'fulfillment_order',
          targetId: fo.id,
          metadata: { previousStatus: fo.status },
        });
        this.logger.log(`Cancelled fulfillment order: ${fo.id}`);
      }

      const closedBacklog = await this.closeOpenFulfillmentBacklogEffects(id, trx);
      for (const backlogId of closedBacklog.backlogIds) {
        effects.push({
          type: 'closed_fulfillment_creation_backlog',
          targetType: 'fulfillment_order_creation_backlog',
          targetId: backlogId,
        });
      }
      if (closedBacklog.closedCount > 0 && closedBacklog.backlogIds.length === 0) {
        effects.push({
          type: 'closed_fulfillment_creation_backlog',
          targetType: 'fulfillment_order_creation_backlog',
          targetExternalRef: `sales_order:${id}:fulfillment_creation_backlog`,
          count: closedBacklog.closedCount,
        });
      }

      const digitalRevocation = await this.revokeDigitalOwnershipEffects(id, options.reasonCode ?? null, trx);
      for (const ownershipId of digitalRevocation.ownershipIds) {
        effects.push({
          type: 'revoked_digital_ownership',
          targetType: 'digital_asset_ownership',
          targetId: ownershipId,
        });
      }
      if (digitalRevocation.revokedCount > 0 && digitalRevocation.ownershipIds.length === 0) {
        effects.push({
          type: 'revoked_digital_ownership',
          targetType: 'digital_asset_ownership',
          targetExternalRef: `sales_order:${id}:digital_ownerships`,
          count: digitalRevocation.revokedCount,
        });
      }

      const occurredAt = options.occurredAt ? new Date(options.occurredAt) : new Date();
      const cancellationValues: SalesOrderCancellationInsert = {
        salesOrderId: id,
        cancellationScope: 'full',
        status: 'applied',
        reasonCode: options.reasonCode ?? null,
        reasonDetail: options.reasonDetail ?? null,
        cancelledBy: options.cancelledBy ?? null,
        effects,
        metadata: options.metadata ?? {},
        occurredAt,
      };
      const [cancellation] = await trx.insert(wmsTables.salesOrderCancellations).values(cancellationValues).returning();

      await trx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(wmsTables.salesOrders.id, id));

      await this.linkCancellationEffects(id, cancellation.id, effects, occurredAt, trx);

      const updated = await this.getOne(id, trx);

      await this.outbox.enqueue(
        {
          eventType: ORDER_EVENTS.CANCELLED,
          aggregateType: 'order',
          aggregateId: id,
          partitionKey: id,
          payload: {
            orderId: id,
            orderCancellationId: cancellation.id,
            cancelledFulfillmentOrderIds,
            closedFulfillmentCreationBacklogIds: closedBacklog.backlogIds,
            revokedDigitalOwnershipIds: digitalRevocation.ownershipIds,
          },
        },
        trx,
      );

      await this.audit?.logResourceChange(
        'ORDER_CANCELLED',
        'cancel',
        'order',
        'salesOrder',
        id,
        `Sales Order ${salesOrder.channelOrderId || id}`,
        { status: salesOrder.status },
        {
          status: 'cancelled',
          orderCancellationId: cancellation.id,
          originalLineCount: originalLines.length,
          effectTypes: effects.map((effect) => effect.type),
        },
        undefined,
        trx,
      );

      this.logger.log(
        `Successfully cancelled sales order ${id} and ${cancelledFulfillmentOrderIds.length} fulfillment orders`,
      );
      return updated;
    }, explicitTx);
  }

  async merge(dto: MergeSalesOrdersDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const sourceIds: string[] = dto?.sourceOrderIds ?? [];
      if (!Array.isArray(sourceIds) || sourceIds.length < 2) {
        return { ok: false, reason: 'NEED_AT_LEAST_TWO_ORDERS' };
      }

      const sources = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(inArray(wmsTables.salesOrders.id, sourceIds));
      if (sources.length !== sourceIds.length) {
        return { ok: false, reason: 'ORDER_NOT_FOUND' };
      }

      const base = sources[0];
      const [merged] = await trx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: dto.channelOrderId ?? base.channelOrderId,
          salesChannel: (dto.salesChannel ?? base.salesChannel) as 'naver' | 'medusa' | 'coupang' | '3pl',
          status: 'pending' as const,
          customerName: dto.customer?.name ?? base.customerName,
          customerEmail: dto.customer?.email ?? base.customerEmail,
          customerPhone: dto.customer?.phone ?? base.customerPhone,
          shippingAddress: (dto.shippingAddress ?? base.shippingAddress) as any,
          shippingAddressHash: dto.shippingAddressHash ?? base.shippingAddressHash,
          totalAmount: dto.totalAmount ?? base.totalAmount,
          shippingFee: dto.shippingFee ?? base.shippingFee,
          mergeGroupId: null,
          isMerged: true,
          orderDate: new Date(),
          confirmedAt: null,
          processedAt: null,
        })
        .returning();

      const mergedLines: SalesOrderLineInsert[] = [];
      for (const so of sources) {
        const soLines = await trx
          .select()
          .from(wmsTables.salesOrderLines)
          .where(eq(wmsTables.salesOrderLines.salesOrderId, so.id));
        for (const l of soLines) {
          mergedLines.push({
            salesOrderId: merged.id,
            variantId: l.variantId,
            productMatchingId: l.productMatchingId,
            productName: l.productName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            totalPrice: l.totalPrice,
            status: 'pending',
            suggestedQuantity: null,
            unavailableSkuIds: null,
            deductedAt: null,
          });
        }
      }
      if (mergedLines.length > 0) {
        await trx.insert(wmsTables.salesOrderLines).values(mergedLines);
      }

      // 원본 SO의 FO 예약 해제 및 취소
      const sourceFOs = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(inArray(wmsTables.fulfillmentOrders.salesOrderId, sourceIds));
      for (const fo of sourceFOs) {
        const fois = await trx
          .select()
          .from(wmsTables.fulfillmentOrderItems)
          .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
        const foiIds = fois.map((item) => item.id);
        if (foiIds.length > 0) {
          const skuIds = [...new Set(fois.map((item) => item.skuId))];
          await trx
            .update(wmsTables.stockReservations)
            .set({ status: 'released' })
            .where(inArray(wmsTables.stockReservations.fulfillmentOrderItemId, foiIds));
          for (const skuId of skuIds) {
            await this.productSellableQuantity.recalculateAndPublishForSku(skuId, trx);
          }
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({ reservedQty: 0, updatedAt: new Date() })
            .where(inArray(wmsTables.fulfillmentOrderItems.id, foiIds));
        }
        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'canceled' })
          .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
      }

      // 원본 SO 취소
      await trx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled' })
        .where(inArray(wmsTables.salesOrders.id, sourceIds));

      // Phase 6: FulfillmentsService 연결 후 FO 재구성
      if (this.fulfillments) {
        try {
          await this.fulfillments.create(
            {
              salesOrderId: merged.id,
              warehouseId: dto.warehouseId ?? undefined,
              shippingAddress: merged.shippingAddress as any,
              lines: [],
            },
            trx,
          );
        } catch {
          // 생성 실패는 무시 (후속 요청에서 생성 가능)
        }
      }

      await this.outbox.enqueue(
        {
          eventType: 'ORDER_MERGED',
          aggregateType: 'order',
          aggregateId: merged.id,
          partitionKey: merged.id,
          payload: { targetOrderId: merged.id, sourceOrderIds: sourceIds },
        },
        trx,
      );

      return merged;
    }, tx);
  }

  async getOne(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const [order] = await db.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, id)).limit(1);
    if (!order) return null;
    const lines = await db
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, id));
    const { links: businessLinks, context } = await this.loadBusinessTimelineLinks(id, db);
    return { ...order, lines, businessTimeline: this.toBusinessTimeline(context, businessLinks) };
  }

  async createBusinessLink(id: string, dto: CreateBusinessLinkDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [order] = await trx
        .select({ id: wmsTables.salesOrders.id })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1);
      if (!order) {
        throw new NotFoundException(`Sales order ${id} not found`);
      }
      if (!dto.target) {
        throw new BadRequestException('Business link target is required');
      }

      const source = this.normalizeBusinessLinkRef(dto.source ?? { type: 'sales_order', id });
      const target = this.normalizeBusinessLinkRef(dto.target);

      if (!this.hasBusinessLinkRef(source)) {
        throw new BadRequestException('Business link source must include id or externalRef');
      }
      if (!this.hasBusinessLinkRef(target)) {
        throw new BadRequestException('Business link target must include id or externalRef');
      }
      const sourceBelongsToTimeline = await this.referencesSalesOrderTimeline(source, id, trx);
      const targetBelongsToTimeline = await this.referencesSalesOrderTimeline(target, id, trx);
      if (!sourceBelongsToTimeline && !targetBelongsToTimeline) {
        throw new BadRequestException(
          'Business link must reference the requested SalesOrder or a lifecycle entity linked to it',
        );
      }

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
      const context = await this.loadBusinessTimelineContext(id, trx);
      if (sourceBelongsToTimeline) {
        this.collectTimelineCsCaseId(context, source.type, source.id);
      }
      if (targetBelongsToTimeline) {
        this.collectTimelineCsCaseId(context, target.type, target.id);
      }
      return this.toBusinessTimelineItem(context, businessLink);
    }, tx);
  }

  async findByChannelOrderId(salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl', channelOrderId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    return db.query.salesOrders.findFirst({
      where: (o, { eq, and }) => and(eq(o.salesChannel, salesChannel), eq(o.channelOrderId, channelOrderId)),
    });
  }

  async list(params: SalesOrderFilterDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const conditions: SQL[] = [];

      if (params.startDate) {
        conditions.push(gte(wmsTables.salesOrders.orderDate, new Date(params.startDate)));
      }
      if (params.endDate) {
        const end = new Date(params.endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(wmsTables.salesOrders.orderDate, end));
      }
      if (params.channel) {
        conditions.push(eq(wmsTables.salesOrders.salesChannel, params.channel));
      }
      if (params.status) {
        conditions.push(eq(wmsTables.salesOrders.status, params.status));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = params.limit ?? 20;
      const offset = params.offset ?? 0;

      const [{ total }] = await trx.select({ total: count() }).from(wmsTables.salesOrders).where(where);

      const orders = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(where)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(wmsTables.salesOrders.createdAt));

      if (orders.length === 0) {
        return { data: [], total, page: Math.floor(offset / limit) + 1, limit, totalPages: Math.ceil(total / limit) };
      }

      const orderIds = orders.map((o) => o.id);
      const lines = await trx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(inArray(wmsTables.salesOrderLines.salesOrderId, orderIds));

      const linesByOrderId = new Map<string, typeof lines>();
      for (const line of lines) {
        if (!linesByOrderId.has(line.salesOrderId)) {
          linesByOrderId.set(line.salesOrderId, []);
        }
        linesByOrderId.get(line.salesOrderId)!.push(line);
      }

      const data = orders.map((order) => ({
        ...order,
        lines: linesByOrderId.get(order.id) || [],
      }));

      return { data, total, page: Math.floor(offset / limit) + 1, limit, totalPages: Math.ceil(total / limit) };
    }, tx);
  }

  async getStats() {
    const db = this.db.db;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
    fourteenDaysAgo.setHours(0, 0, 0, 0);

    const [todayResult] = await db
      .select({ cnt: count() })
      .from(wmsTables.salesOrders)
      .where(and(gte(wmsTables.salesOrders.orderDate, today), lte(wmsTables.salesOrders.orderDate, todayEnd)));

    const statusCounts = await db
      .select({ status: wmsTables.salesOrders.status, cnt: count() })
      .from(wmsTables.salesOrders)
      .where(gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo))
      .groupBy(wmsTables.salesOrders.status);

    const byStatus = (s: string) => Number(statusCounts.find((r) => r.status === s)?.cnt ?? 0);

    const waitingMatchRows = await db
      .select({ id: wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId })
      .from(wmsTables.fulfillmentOrderCreationBacklogs)
      .innerJoin(
        wmsTables.salesOrders,
        eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId),
      )
      .where(
        and(
          gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
          eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'),
        ),
      )
      .groupBy(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId);

    const cannotShipRows = await db
      .select({ id: wmsTables.salesOrders.id })
      .from(wmsTables.salesOrders)
      .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.salesOrderId, wmsTables.salesOrders.id))
      .where(
        and(
          gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
          eq(wmsTables.salesOrders.status, 'confirmed'),
          eq(wmsTables.salesOrderLines.status, 'stock_unavailable'),
        ),
      )
      .groupBy(wmsTables.salesOrders.id);

    let partialOutboundCount = 0;
    if (cannotShipRows.length > 0) {
      const cannotShipOrderIds = cannotShipRows.map((r) => r.id);
      const deductedRows = await db
        .select({ id: wmsTables.salesOrders.id })
        .from(wmsTables.salesOrders)
        .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.salesOrderId, wmsTables.salesOrders.id))
        .where(
          and(
            inArray(wmsTables.salesOrders.id, cannotShipOrderIds),
            eq(wmsTables.salesOrderLines.status, 'stock_deducted'),
          ),
        )
        .groupBy(wmsTables.salesOrders.id);
      partialOutboundCount = deductedRows.length;
    }

    const directShipRows = await db
      .select({ id: wmsTables.fulfillmentOrders.id })
      .from(wmsTables.fulfillmentOrders)
      .innerJoin(
        wmsTables.salesOrders,
        and(
          eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId),
          gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
        ),
      )
      .where(eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'drop_ship'));

    return {
      todayCount: Number(todayResult.cnt),
      outboundRequested: byStatus('confirmed'),
      directShip: directShipRows.length,
      cannotShip: cannotShipRows.length,
      partialOutbound: partialOutboundCount,
      waitingMatching: waitingMatchRows.length,
      outboundComplete: byStatus('processing') + byStatus('shipped') + byStatus('delivered'),
    };
  }

  async createFromEvent(payload: OrderCreatedPayload, tx?: DbTx) {
    const dto: CreateSalesOrderDto = {
      channelOrderId: payload.externalOrderId ?? payload.orderId,
      salesChannel: payload.salesChannel,
      customer: {
        id: payload.customerId,
        name: payload.shippingAddress.recipientName,
        phone: payload.shippingAddress.phone,
      },
      shippingAddress: this.convertShippingAddress(payload.shippingAddress),
      totalAmount: payload.totalAmount,
      shippingFee: payload.shippingAmount ?? 0,
      orderDate: payload.createdAt,
      lines: this.convertOrderItems(payload.items),
    };
    return this.create(dto, tx);
  }

  async updateFromEvent(id: string, changes: OrderModifiedPayload['changes'], tx?: DbTx) {
    return this.inTx(async (trx) => {
      this.logger.warn(
        `[updateFromEvent] Ignored post-acceptance OrderModified for sales order ${id}; ` +
          'use SalesOrderAmendment or OrderCancellation workflows for contract changes.',
      );
      return this.getOne(id, trx);
    }, tx);
  }

  private normalizeCancelArgs(
    optionsOrTx?: CancelSalesOrderOptions | DbTx,
    tx?: DbTx,
  ): { options: CancelSalesOrderOptions; tx?: DbTx } {
    if (this.isDbTx(optionsOrTx)) {
      return { options: {}, tx: optionsOrTx };
    }
    return { options: optionsOrTx ?? {}, tx };
  }

  private isDbTx(value: unknown): value is DbTx {
    return Boolean(value && typeof value === 'object' && 'select' in value && 'insert' in value);
  }

  private async closeOpenFulfillmentBacklogEffects(
    salesOrderId: string,
    trx: DbTx,
  ): Promise<{ closedCount: number; backlogIds: string[] }> {
    const backlogWithDetails = this.fulfillmentBacklog as FulfillmentOrderCreationBacklogService & {
      closeOpenForSalesOrderDetailed?: (
        salesOrderId: string,
        tx?: DbTx,
      ) => Promise<{ closedCount: number; backlogIds: string[] }>;
    };

    if (typeof backlogWithDetails.closeOpenForSalesOrderDetailed === 'function') {
      return backlogWithDetails.closeOpenForSalesOrderDetailed(salesOrderId, trx);
    }

    const closedCount = await this.fulfillmentBacklog.closeOpenForSalesOrder(salesOrderId, trx);
    return { closedCount, backlogIds: [] };
  }

  private async revokeDigitalOwnershipEffects(
    salesOrderId: string,
    reason: string | null,
    trx: DbTx,
  ): Promise<{ revokedCount: number; ownershipIds: string[] }> {
    if (!this.library) {
      return { revokedCount: 0, ownershipIds: [] };
    }

    const libraryWithDetails = this.library as LibraryService & {
      revokeOwnershipsForOrderDetailed?: (
        salesOrderId: string,
        reason: string | null,
        tx?: DbTx,
      ) => Promise<{ revokedCount: number; ownershipIds: string[] }>;
    };

    if (typeof libraryWithDetails.revokeOwnershipsForOrderDetailed === 'function') {
      return libraryWithDetails.revokeOwnershipsForOrderDetailed(salesOrderId, reason, trx);
    }

    const revokedCount = await this.library.revokeOwnershipsForOrder(salesOrderId, reason, trx);
    return { revokedCount, ownershipIds: [] };
  }

  private async linkCancellationEffects(
    salesOrderId: string,
    cancellationId: string,
    effects: CancellationEffect[],
    occurredAt: Date,
    trx: DbTx,
  ) {
    const links: BusinessLinkInsert[] = [
      {
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: salesOrderId,
        sourceExternalRef: null,
        targetType: ORDER_CANCELLATION_REF_TYPE,
        targetId: cancellationId,
        targetExternalRef: null,
        relationName: 'opened_cancellation',
        metadata: {
          cancellationScope: 'full',
          effectTypes: effects.map((effect) => effect.type),
        },
        occurredAt,
      },
    ];

    for (const effect of effects) {
      if (!effect.targetType || (!effect.targetId && !effect.targetExternalRef)) continue;
      links.push({
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: salesOrderId,
        sourceExternalRef: null,
        targetType: effect.targetType,
        targetId: effect.targetId ?? null,
        targetExternalRef: effect.targetExternalRef ?? null,
        relationName: `cancellation_${effect.type}`,
        metadata: {
          orderCancellationId: cancellationId,
          ...effect.metadata,
          ...(effect.count !== undefined ? { count: effect.count } : {}),
        },
        occurredAt,
      });
    }

    await trx.insert(wmsTables.businessLinks).values(links);
  }

  private assertAcceptedContractIsNotPatched(salesOrder: { salesChannel: string }, dto: SalesOrderPatchInput): void {
    if (!ACCEPTED_CONTRACT_CHANNELS.has(salesOrder.salesChannel)) {
      return;
    }

    const attemptedContractFields = CONTRACT_PATCH_FIELDS.filter((field) => dto[field] !== undefined);
    if (attemptedContractFields.length === 0) {
      return;
    }

    throw new BadRequestException(
      `Accepted SalesOrder contract fields are immutable: ${attemptedContractFields.join(
        ', ',
      )}. Use SalesOrderAmendment or OrderCancellation workflows for post-acceptance changes.`,
    );
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

  private referencesSalesOrder(ref: BusinessLinkReference, salesOrderId: string): boolean {
    return ref.type === 'sales_order' && ref.id === salesOrderId;
  }

  private async referencesSalesOrderTimeline(ref: BusinessLinkReference, salesOrderId: string, trx: DbTx) {
    if (this.referencesSalesOrder(ref, salesOrderId)) {
      return true;
    }
    if (!ref.id) {
      return false;
    }

    if (ref.type === ORDER_CANCELLATION_REF_TYPE) {
      const [cancellation] = await trx
        .select({ id: wmsTables.salesOrderCancellations.id })
        .from(wmsTables.salesOrderCancellations)
        .where(
          and(
            eq(wmsTables.salesOrderCancellations.id, ref.id),
            eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          ),
        )
        .limit(1);
      return Boolean(cancellation);
    }

    if (ref.type === SALES_ORDER_AMENDMENT_REF_TYPE) {
      const [amendment] = await trx
        .select({ id: wmsTables.salesOrderAmendments.id })
        .from(wmsTables.salesOrderAmendments)
        .where(
          and(
            eq(wmsTables.salesOrderAmendments.id, ref.id),
            eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId),
          ),
        )
        .limit(1);
      return Boolean(amendment);
    }

    if (ref.type === CS_CASE_REF_TYPE) {
      const context = await this.loadBusinessTimelineContext(salesOrderId, trx);
      const lifecycleAnchorFilters = [
        and(
          eq(wmsTables.businessLinks.targetType, SALES_ORDER_REF_TYPE),
          eq(wmsTables.businessLinks.targetId, salesOrderId),
        ),
        and(
          eq(wmsTables.businessLinks.sourceType, SALES_ORDER_REF_TYPE),
          eq(wmsTables.businessLinks.sourceId, salesOrderId),
        ),
        ...[...context.cancellationIds].flatMap((cancellationId) => [
          and(
            eq(wmsTables.businessLinks.targetType, ORDER_CANCELLATION_REF_TYPE),
            eq(wmsTables.businessLinks.targetId, cancellationId),
          ),
          and(
            eq(wmsTables.businessLinks.sourceType, ORDER_CANCELLATION_REF_TYPE),
            eq(wmsTables.businessLinks.sourceId, cancellationId),
          ),
        ]),
        ...[...context.amendmentIds].flatMap((amendmentId) => [
          and(
            eq(wmsTables.businessLinks.targetType, SALES_ORDER_AMENDMENT_REF_TYPE),
            eq(wmsTables.businessLinks.targetId, amendmentId),
          ),
          and(
            eq(wmsTables.businessLinks.sourceType, SALES_ORDER_AMENDMENT_REF_TYPE),
            eq(wmsTables.businessLinks.sourceId, amendmentId),
          ),
        ]),
      ].filter((filter): filter is SQL => Boolean(filter));
      const linkedSalesOrderRefs = await trx
        .select({ id: wmsTables.businessLinks.id })
        .from(wmsTables.businessLinks)
        .where(
          and(
            or(
              and(
                eq(wmsTables.businessLinks.sourceType, CS_CASE_REF_TYPE),
                eq(wmsTables.businessLinks.sourceId, ref.id),
              ),
              and(
                eq(wmsTables.businessLinks.targetType, CS_CASE_REF_TYPE),
                eq(wmsTables.businessLinks.targetId, ref.id),
              ),
            ),
            or(...lifecycleAnchorFilters),
          ),
        )
        .limit(1);
      return linkedSalesOrderRefs.length > 0;
    }

    return false;
  }

  private async loadBusinessTimelineContext(
    salesOrderId: string,
    db: DbTx | WmsDb,
  ): Promise<SalesOrderTimelineContext> {
    const [cancellations, amendments] = await Promise.all([
      db
        .select({ id: wmsTables.salesOrderCancellations.id })
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId)),
      db
        .select({ id: wmsTables.salesOrderAmendments.id })
        .from(wmsTables.salesOrderAmendments)
        .where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId)),
    ]);

    return {
      salesOrderId,
      cancellationIds: new Set(cancellations.map((row) => row.id)),
      amendmentIds: new Set(amendments.map((row) => row.id)),
      csCaseIds: new Set(),
    };
  }

  private async loadBusinessTimelineLinks(salesOrderId: string, db: DbTx | WmsDb) {
    const context = await this.loadBusinessTimelineContext(salesOrderId, db);
    const anchorFilters: SQL[] = [
      and(
        eq(wmsTables.businessLinks.sourceType, SALES_ORDER_REF_TYPE),
        eq(wmsTables.businessLinks.sourceId, salesOrderId),
      )!,
      and(
        eq(wmsTables.businessLinks.targetType, SALES_ORDER_REF_TYPE),
        eq(wmsTables.businessLinks.targetId, salesOrderId),
      )!,
    ];

    for (const cancellationId of context.cancellationIds) {
      anchorFilters.push(
        and(
          eq(wmsTables.businessLinks.sourceType, ORDER_CANCELLATION_REF_TYPE),
          eq(wmsTables.businessLinks.sourceId, cancellationId),
        )!,
        and(
          eq(wmsTables.businessLinks.targetType, ORDER_CANCELLATION_REF_TYPE),
          eq(wmsTables.businessLinks.targetId, cancellationId),
        )!,
      );
    }

    for (const amendmentId of context.amendmentIds) {
      anchorFilters.push(
        and(
          eq(wmsTables.businessLinks.sourceType, SALES_ORDER_AMENDMENT_REF_TYPE),
          eq(wmsTables.businessLinks.sourceId, amendmentId),
        )!,
        and(
          eq(wmsTables.businessLinks.targetType, SALES_ORDER_AMENDMENT_REF_TYPE),
          eq(wmsTables.businessLinks.targetId, amendmentId),
        )!,
      );
    }

    const directLinks = await db
      .select()
      .from(wmsTables.businessLinks)
      .where(or(...anchorFilters));

    for (const link of directLinks) {
      this.collectTimelineCsCaseId(context, link.sourceType, link.sourceId);
      this.collectTimelineCsCaseId(context, link.targetType, link.targetId);
    }

    if (context.csCaseIds.size === 0) {
      return { links: directLinks, context };
    }

    const csCaseFilters: SQL[] = [];
    for (const csCaseId of context.csCaseIds) {
      csCaseFilters.push(
        and(eq(wmsTables.businessLinks.sourceType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.sourceId, csCaseId))!,
        and(eq(wmsTables.businessLinks.targetType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.targetId, csCaseId))!,
      );
    }
    const csCaseLinks = await db
      .select()
      .from(wmsTables.businessLinks)
      .where(or(...csCaseFilters));

    const linksById = new Map<string, BusinessLinkRow>();
    for (const link of [...directLinks, ...csCaseLinks]) {
      linksById.set(link.id, link);
    }

    return { links: [...linksById.values()], context };
  }

  private collectTimelineCsCaseId(context: SalesOrderTimelineContext, type: string, id: string | null) {
    if (type === CS_CASE_REF_TYPE && id) {
      context.csCaseIds.add(id);
    }
  }

  private toBusinessTimeline(context: SalesOrderTimelineContext, links: BusinessLinkRow[]) {
    return links
      .map((link) => this.toBusinessTimelineItem(context, link))
      .sort((a, b) => {
        const occurred = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (occurred !== 0) return occurred;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  private toBusinessTimelineItem(context: SalesOrderTimelineContext, link: BusinessLinkRow) {
    const source = this.toBusinessLinkRef(link.sourceType, link.sourceId, link.sourceExternalRef);
    const target = this.toBusinessLinkRef(link.targetType, link.targetId, link.targetExternalRef);
    const direction =
      this.referencesSalesOrder(source, context.salesOrderId) ||
      (!this.referencesSalesOrder(target, context.salesOrderId) && this.isTimelineAnchorRef(source, context))
        ? 'outbound'
        : 'inbound';
    const linkedEntity = direction === 'outbound' ? target : source;

    return {
      id: link.id,
      relationName: link.relationName,
      direction,
      source,
      target,
      linkedEntity,
      metadata: (link.metadata ?? {}) as Record<string, unknown>,
      effectStatus: this.toTimelineEffectStatus(linkedEntity, (link.metadata ?? {}) as Record<string, unknown>),
      occurredAt: link.occurredAt,
      createdAt: link.createdAt,
    };
  }

  private isTimelineAnchorRef(ref: BusinessLinkReference, context: SalesOrderTimelineContext): boolean {
    if (this.referencesSalesOrder(ref, context.salesOrderId)) {
      return true;
    }
    if (!ref.id) {
      return false;
    }
    if (ref.type === ORDER_CANCELLATION_REF_TYPE) {
      return context.cancellationIds.has(ref.id);
    }
    if (ref.type === SALES_ORDER_AMENDMENT_REF_TYPE) {
      return context.amendmentIds.has(ref.id);
    }
    if (ref.type === CS_CASE_REF_TYPE) {
      return context.csCaseIds.has(ref.id);
    }
    return false;
  }

  private toTimelineEffectStatus(
    linkedEntity: BusinessLinkReference,
    metadata: Record<string, unknown>,
  ): TimelineEffectStatus | null {
    if (!WALLET_EFFECT_REF_TYPES.has(linkedEntity.type)) {
      return null;
    }

    const value = metadata.walletStatus ?? metadata.refundStatus ?? metadata.paymentStatus ?? metadata.status;
    return typeof value === 'string' && value.length > 0 ? { owner: 'wallet', value } : null;
  }

  private toBusinessLinkRef(type: string, id: string | null, externalRef: string | null): BusinessLinkReference {
    return { type, id, externalRef };
  }

  private convertShippingAddress(address: ShippingAddress): AddressDto {
    return {
      recipientName: address.recipientName,
      phone: address.phone,
      postalCode: address.postalCode,
      roadAddress: address.roadAddress,
      detailAddress: address.detailAddress,
      deliveryNote: address.deliveryNote,
    };
  }

  private convertOrderItems(items: OrderItem[]) {
    return items.map((item) => ({
      variantId: item.variantId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    }));
  }
}
