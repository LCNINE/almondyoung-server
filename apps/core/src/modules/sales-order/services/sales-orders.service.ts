import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, inArray, desc, and, gte, lte, count, isNull, type InferInsertModel, type SQL } from 'drizzle-orm';
import { PoliciesService } from './policies.service';
import { OutboxService } from '../../inventory/shared/outbox/outbox.service';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { MetricsService } from '../../inventory/shared/services/metrics.service';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { ORDER_EVENTS } from '../common/events';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { MergeSalesOrdersDto } from '../dto/merge-sales-orders.dto';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { AddressDto } from '../dto/address.dto';
import { OrderCreatedPayload, OrderModifiedPayload, ShippingAddress, OrderItem } from '@packages/event-contracts';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';

type SalesOrderLineInsert = InferInsertModel<typeof wmsTables.salesOrderLines>;

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
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly fulfillments?: IFulfillmentsService,
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
      await trx
        .update(wmsTables.salesOrders)
        .set({
          customerName: dto.customer?.name ?? null,
          customerEmail: dto.customer?.email ?? null,
          customerPhone: dto.customer?.phone ?? null,
          shippingAddress: dto.shippingAddress,
          totalAmount: dto.totalAmount ?? null,
          shippingFee: dto.shippingFee ?? 0,
          processedAt: dto.processedAt ? new Date(dto.processedAt) : null,
          memo: dto.memo ?? null,
        })
        .where(eq(wmsTables.salesOrders.id, id));
      const updated = await this.getOne(id, trx);
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

  async cancel(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      this.logger.log(`Cancelling sales order: ${id}`);

      const salesOrder = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1)
        .then((r) => r[0]);

      if (!salesOrder) throw new Error(`Sales order ${id} not found`);
      if (salesOrder.status === 'cancelled') {
        this.logger.warn(`Sales order ${id} is already cancelled`);
        return salesOrder;
      }

      const fulfillmentOrders = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, id));

      this.logger.log(`Found ${fulfillmentOrders.length} fulfillment orders for SO ${id}`);

      for (const fo of fulfillmentOrders) {
        if (fo.status === 'canceled') continue;

        try {
          await this.reservationLifecycle.handleFulfillmentOrderStatusChange(fo.id, fo.status, 'canceled', trx);
        } catch (error) {
          this.logger.error(`Failed to release reservations for FO ${fo.id}:`, error);
        }

        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'canceled' })
          .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

        this.logger.log(`Cancelled fulfillment order: ${fo.id}`);
      }

      await trx.update(wmsTables.salesOrders).set({ status: 'cancelled' }).where(eq(wmsTables.salesOrders.id, id));

      const updated = await this.getOne(id, trx);

      await this.outbox.enqueue(
        {
          eventType: ORDER_EVENTS.CANCELLED,
          aggregateType: 'order',
          aggregateId: id,
          partitionKey: id,
          payload: { orderId: id, cancelledFulfillmentOrderIds: fulfillmentOrders.map((fo) => fo.id) },
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
        { status: 'cancelled' },
        undefined,
        trx,
      );

      this.logger.log(`Successfully cancelled sales order ${id} and ${fulfillmentOrders.length} fulfillment orders`);
      return updated;
    }, tx);
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
    return { ...order, lines };
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
      .select({ id: wmsTables.salesOrders.id })
      .from(wmsTables.salesOrders)
      .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.salesOrderId, wmsTables.salesOrders.id))
      .where(
        and(
          gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
          eq(wmsTables.salesOrders.status, 'pending'),
          isNull(wmsTables.salesOrderLines.productMatchingId),
        ),
      )
      .groupBy(wmsTables.salesOrders.id);

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
      const updateData: Record<string, any> = {};

      if (changes.shippingAddress) {
        updateData.shippingAddress = this.convertShippingAddress(changes.shippingAddress);
      }
      if (changes.totalAmount !== undefined) {
        updateData.totalAmount = changes.totalAmount;
      }

      if (Object.keys(updateData).length > 0) {
        await trx
          .update(wmsTables.salesOrders)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(wmsTables.salesOrders.id, id));
      }

      if (changes.items && changes.items.length > 0) {
        this.logger.warn(`[updateFromEvent] Item changes not yet implemented for order ${id}`);
      }

      const updated = await this.getOne(id, trx);
      await this.outbox.enqueue(
        {
          eventType: ORDER_EVENTS.MODIFIED,
          aggregateType: 'order',
          aggregateId: id,
          partitionKey: id,
          payload: { orderId: id, changes },
        },
        trx,
      );
      return updated;
    }, tx);
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
