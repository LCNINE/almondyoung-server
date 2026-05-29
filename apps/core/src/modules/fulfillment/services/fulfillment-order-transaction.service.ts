import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';

export interface CreateFulfillmentOrderDto {
  warehouseId: string;
  fulfillmentMode: 'in_house' | '3pl' | 'drop_ship';
  priority: 'normal' | 'high' | 'urgent';
  items: Array<{
    salesOrderId: string | null;
    salesOrderLineId: string | null;
    productId: string;
    variantId: string;
    qty: number;
  }>;
}

export interface FulfillmentOrderResult {
  fulfillmentOrderId: string;
  items: Array<{
    id: string;
    salesOrderId: string | null;
    salesOrderLineId: string | null;
    variantId: string | null;
    skuId: string;
    qty: number;
    reservedQty: number;
  }>;
  reservations: Array<{
    id: string;
    skuId: string;
    qty: number;
    foiId: string;
  }>;
}

@Injectable()
export class FulfillmentOrderTransactionService {
  private readonly logger = new Logger(FulfillmentOrderTransactionService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSkuMappingService: ProductSkuMappingService,
    private readonly reservationLifecycle: ReservationLifecycleService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async createFulfillmentOrder(dto: CreateFulfillmentOrderDto, tx?: DbTx): Promise<FulfillmentOrderResult> {
    const { warehouseId, fulfillmentMode, priority, items } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('FO items cannot be empty');
    }

    return this.inTx(async (trx) => {
      await this.validateItems(items, warehouseId, trx);

      const [fulfillmentOrder] = await trx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          warehouseId,
          fulfillmentMode,
          priority,
          status: 'created',
          totalItems: items.length,
          totalQty: items.reduce((sum, item) => sum + item.qty, 0),
        })
        .returning();

      const foItems: FulfillmentOrderResult['items'] = [];
      const reservations: FulfillmentOrderResult['reservations'] = [];

      for (const item of items) {
        const mappingSnapshot = await this.productSkuMappingService.getMappingSnapshot(
          await this.getActiveMappingId(item.productId, warehouseId, trx),
          trx,
        );

        const variantMapping = mappingSnapshot.mappings.find((m: any) => m.variantId === item.variantId);
        if (!variantMapping) {
          throw new BadRequestException(
            `No SKU mapping found for variant ${item.variantId} in product ${item.productId}`,
          );
        }

        const requiredSkuQty = item.qty * variantMapping.quantity;

        const availableStock = await this.checkStockAvailability(variantMapping.skuId, warehouseId, trx);
        if (availableStock < requiredSkuQty) {
          throw new ConflictException(
            `Insufficient stock for SKU ${variantMapping.skuId}. Required: ${requiredSkuQty}, Available: ${availableStock}`,
          );
        }

        const [foItem] = await trx
          .insert(wmsTables.fulfillmentOrderItems)
          .values({
            fulfillmentOrderId: fulfillmentOrder.id,
            salesOrderId: item.salesOrderId,
            salesOrderLineId: item.salesOrderLineId,
            mappingSnapshotId: mappingSnapshot.id,
            skuId: variantMapping.skuId,
            qty: item.qty,
            reservedQty: 0,
            pickedQty: 0,
            shippedQty: 0,
          })
          .returning();

        const [reservation] = await trx
          .insert(wmsTables.stockReservations)
          .values({
            targetType: 'FULFILLMENT_ORDER',
            targetId: fulfillmentOrder.id,
            fulfillmentOrderItemId: foItem.id,
            skuId: variantMapping.skuId,
            warehouseId,
            quantity: requiredSkuQty,
            status: 'active',
          })
          .returning();

        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ reservedQty: requiredSkuQty })
          .where(eq(wmsTables.fulfillmentOrderItems.id, foItem.id));

        foItems.push({
          id: foItem.id,
          salesOrderId: foItem.salesOrderId,
          salesOrderLineId: foItem.salesOrderLineId,
          variantId: item.variantId,
          skuId: variantMapping.skuId,
          qty: item.qty,
          reservedQty: requiredSkuQty,
        });

        reservations.push({
          id: reservation.id,
          skuId: variantMapping.skuId,
          qty: requiredSkuQty,
          foiId: foItem.id,
        });
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'pending',
          totalReservedQty: reservations.reduce((sum, r) => sum + r.qty, 0),
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrder.id));

      this.logger.log(
        `Created FO ${fulfillmentOrder.id} with ${foItems.length} items, ${reservations.length} reservations`,
      );

      return {
        fulfillmentOrderId: fulfillmentOrder.id,
        items: foItems,
        reservations,
      };
    }, tx);
  }

  async cancelFulfillmentOrder(fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      if (fulfillmentOrder.status === 'completed' || fulfillmentOrder.status === 'shipped') {
        throw new ConflictException(`Cannot cancel FO in status: ${fulfillmentOrder.status}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled', canceledAt: new Date(), totalReservedQty: 0 })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      await this.reservationLifecycle.handleFulfillmentOrderStatusChange(
        fulfillmentOrderId,
        fulfillmentOrder.status,
        'canceled',
        trx,
      );

      this.logger.log(`Canceled FO ${fulfillmentOrderId} and released reservations via lifecycle service`);
    }, tx);
  }

  async completeFulfillmentOrder(fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      if (fulfillmentOrder.status === 'completed') return;

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'completed', updatedAt: new Date(), totalReservedQty: 0 })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      await this.reservationLifecycle.handleFulfillmentOrderStatusChange(
        fulfillmentOrderId,
        fulfillmentOrder.status,
        'completed',
        trx,
      );

      this.logger.log(`Completed FO ${fulfillmentOrderId} and released reservations`);
    }, tx);
  }

  async shipFulfillmentOrder(fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped', shippedAt: new Date(), totalReservedQty: 0 })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      await this.reservationLifecycle.handleFulfillmentOrderStatusChange(
        fulfillmentOrderId,
        fulfillmentOrder.status,
        'shipped',
        trx,
      );

      this.logger.log(`Shipped FO ${fulfillmentOrderId} and released reservations`);
    }, tx);
  }

  async updateFulfillmentOrderPriority(
    fulfillmentOrderId: string,
    priority: 'normal' | 'high' | 'urgent',
    tx?: DbTx,
  ): Promise<void> {
    return this.inTx(async (trx) => {
      const [updated] = await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ priority, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .returning();

      if (!updated) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      this.logger.log(`Updated FO ${fulfillmentOrderId} priority to ${priority}`);
    }, tx);
  }

  async allocateToOutboundBatch(fulfillmentOrderId: string, batchId: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          status: wmsTables.fulfillmentOrders.status,
          totalItems: wmsTables.fulfillmentOrders.totalItems,
          totalQty: wmsTables.fulfillmentOrders.totalQty,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      if (!['ready', 'pending'].includes(fulfillmentOrder.status)) {
        throw new ConflictException(`FO must be ready for allocation. Current: ${fulfillmentOrder.status}`);
      }

      const batchRows = await trx
        .select({ id: wmsTables.outboundBatches.id, status: wmsTables.outboundBatches.status })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];

      if (!batch) {
        throw new BadRequestException(`Outbound batch ${batchId} not found`);
      }

      if (batch.status !== 'created') {
        throw new ConflictException(`Batch must be in created status. Current: ${batch.status}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'allocated', batchId, allocatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      const currentBatchItemsRows = await trx
        .select({ totalItems: wmsTables.outboundBatches.totalItems, totalQty: wmsTables.outboundBatches.totalQty })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const currentBatchItems = currentBatchItemsRows[0];

      await trx
        .update(wmsTables.outboundBatches)
        .set({
          totalItems: (currentBatchItems?.totalItems || 0) + (fulfillmentOrder.totalItems ?? 0),
          totalQty: (currentBatchItems?.totalQty || 0) + (fulfillmentOrder.totalQty ?? 0),
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Allocated FO ${fulfillmentOrderId} to batch ${batchId}`);
    }, tx);
  }

  private async validateItems(items: CreateFulfillmentOrderDto['items'], warehouseId: string, tx: DbTx): Promise<void> {
    const uniqueItems = new Map<string, number>();

    for (const item of items) {
      const key = `${item.salesOrderId}-${item.salesOrderLineId}`;

      if (uniqueItems.has(key)) {
        throw new BadRequestException(`Duplicate sales order line: ${key}`);
      }

      uniqueItems.set(key, item.qty);

      if (item.qty <= 0) {
        throw new BadRequestException(`Invalid quantity for item ${key}: ${item.qty}`);
      }

      const mapping = await this.productSkuMappingService.getActiveMapping(item.productId, warehouseId, tx);
      if (!mapping) {
        throw new BadRequestException(
          `No active mapping found for product ${item.productId} in warehouse ${warehouseId}`,
        );
      }

      const hasVariant = mapping.mappings.some((m: any) => m.variantId === item.variantId);
      if (!hasVariant) {
        throw new BadRequestException(`Variant ${item.variantId} not found in product ${item.productId} mapping`);
      }
    }
  }

  private async getActiveMappingId(productId: string, warehouseId: string, tx: DbTx): Promise<string> {
    const mapping = await tx.query.productSkuMappings.findFirst({
      where: and(
        eq(wmsTables.productSkuMappings.productId, productId),
        eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
        eq(wmsTables.productSkuMappings.isActive, true),
      ),
    });

    if (!mapping) {
      throw new BadRequestException(`No active mapping for product ${productId} in warehouse ${warehouseId}`);
    }

    return mapping.id;
  }

  private async checkStockAvailability(skuId: string, warehouseId: string, tx: DbTx): Promise<number> {
    const stockLedgers = await tx.query.stockLedgers.findMany({
      where: and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    });

    if (stockLedgers.length === 0) return 0;

    const reservations = await tx.query.stockReservations.findMany({
      where: and(
        eq(wmsTables.stockReservations.skuId, skuId),
        eq(wmsTables.stockReservations.warehouseId, warehouseId),
        eq(wmsTables.stockReservations.status, 'active'),
      ),
    });

    const totalOnHand = stockLedgers.reduce((sum, ledger) => sum + ledger.qty, 0);
    const totalReserved = reservations.reduce((sum, r) => sum + r.quantity, 0);
    return Math.max(0, totalOnHand - totalReserved);
  }
}
