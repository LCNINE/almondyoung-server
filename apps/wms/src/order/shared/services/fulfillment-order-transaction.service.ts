import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { ProductSkuMappingService } from './product-sku-mapping.service';

export interface CreateFulfillmentOrderDto {
  warehouseId: string;
  fulfillmentMode: 'in_house' | 'third_party' | 'direct_ship';
  priority: 'normal' | 'high' | 'urgent';
  items: Array<{
    salesOrderId: string;
    salesOrderLineId: string;
    productId: string;
    variantId: string;
    qty: number;
  }>;
}

export interface FulfillmentOrderResult {
  fulfillmentOrderId: string;
  items: Array<{
    id: string;
    salesOrderId: string;
    salesOrderLineId: string;
    variantId: string;
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
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly productSkuMappingService: ProductSkuMappingService
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async createFulfillmentOrder(dto: CreateFulfillmentOrderDto): Promise<FulfillmentOrderResult> {
    const { warehouseId, fulfillmentMode, priority, items } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('FO items cannot be empty');
    }

    await this.validateItems(items, warehouseId);

    return this.db.transaction(async (tx) => {
      const [fulfillmentOrder] = await tx.insert(wmsTables.fulfillmentOrders)
        .values({
          warehouseId,
          fulfillmentMode,
          priority,
          status: 'created',
          totalItems: items.length,
          totalQty: items.reduce((sum, item) => sum + item.qty, 0)
        })
        .returning();

      const foItems: FulfillmentOrderResult['items'] = [];
      const reservations: FulfillmentOrderResult['reservations'] = [];

      for (const item of items) {
        const mappingSnapshot = await this.productSkuMappingService.getMappingSnapshot(
          await this.getActiveMappingId(item.productId, warehouseId, tx)
        );

        const variantMapping = mappingSnapshot.mappings.find(m => m.variantId === item.variantId);
        if (!variantMapping) {
          throw new BadRequestException(`No SKU mapping found for variant ${item.variantId} in product ${item.productId}`);
        }

        const requiredSkuQty = item.qty * variantMapping.quantity;

        const availableStock = await this.checkStockAvailability(variantMapping.skuId, warehouseId, tx);
        if (availableStock < requiredSkuQty) {
          throw new ConflictException(
            `Insufficient stock for SKU ${variantMapping.skuId}. Required: ${requiredSkuQty}, Available: ${availableStock}`
          );
        }

        const [foItem] = await tx.insert(wmsTables.fulfillmentOrderItems)
          .values({
            fulfillmentOrderId: fulfillmentOrder.id,
            salesOrderId: item.salesOrderId,
            salesOrderLineId: item.salesOrderLineId,
            mappingSnapshotId: mappingSnapshot.id,
            skuId: variantMapping.skuId,
            qty: item.qty,
            reservedQty: 0,
            pickedQty: 0,
            shippedQty: 0
          })
          .returning();

        const [reservation] = await tx.insert(wmsTables.stockReservations)
          .values({
            skuId: variantMapping.skuId,
            warehouseId,
            fulfillmentOrderItemId: foItem.id,
            qty: requiredSkuQty,
            reservationType: 'sales',
            status: 'active'
          })
          .returning();

        await tx.update(wmsTables.fulfillmentOrderItems)
          .set({ reservedQty: requiredSkuQty })
          .where(eq(wmsTables.fulfillmentOrderItems.id, foItem.id));

        foItems.push({
          id: foItem.id,
          salesOrderId: foItem.salesOrderId,
          salesOrderLineId: foItem.salesOrderLineId,
          variantId: item.variantId,
          skuId: variantMapping.skuId,
          qty: item.qty,
          reservedQty: requiredSkuQty
        });

        reservations.push({
          id: reservation.id,
          skuId: variantMapping.skuId,
          qty: requiredSkuQty,
          foiId: foItem.id
        });
      }

      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'pending',
          totalReservedQty: reservations.reduce((sum, r) => sum + r.qty, 0)
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrder.id));

      this.logger.log(
        `Created FO ${fulfillmentOrder.id} with ${foItems.length} items, ${reservations.length} reservations`
      );

      return {
        fulfillmentOrderId: fulfillmentOrder.id,
        items: foItems,
        reservations
      };
    });
  }

  async cancelFulfillmentOrder(fulfillmentOrderId: string): Promise<void> {
    const fulfillmentOrder = await this.db.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
      with: {
        items: true
      }
    });

    if (!fulfillmentOrder) {
      throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    if (fulfillmentOrder.status === 'completed' || fulfillmentOrder.status === 'shipped') {
      throw new ConflictException(`Cannot cancel FO in status: ${fulfillmentOrder.status}`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.stockReservations)
        .set({ status: 'canceled', canceledAt: new Date() })
        .where(
          inArray(
            wmsTables.stockReservations.fulfillmentOrderItemId,
            fulfillmentOrder.items.map(item => item.id)
          )
        );

      await tx.update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: 0 })
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'canceled',
          canceledAt: new Date(),
          totalReservedQty: 0
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      this.logger.log(`Canceled FO ${fulfillmentOrderId} and released ${fulfillmentOrder.items.length} reservations`);
    });
  }

  async updateFulfillmentOrderPriority(fulfillmentOrderId: string, priority: 'normal' | 'high' | 'urgent'): Promise<void> {
    const [updated] = await this.db.update(wmsTables.fulfillmentOrders)
      .set({ priority, updatedAt: new Date() })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
      .returning();

    if (!updated) {
      throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    this.logger.log(`Updated FO ${fulfillmentOrderId} priority to ${priority}`);
  }

  async allocateToOutboundBatch(fulfillmentOrderId: string, batchId: string): Promise<void> {
    const fulfillmentOrder = await this.db.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId)
    });

    if (!fulfillmentOrder) {
      throw new BadRequestException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    if (fulfillmentOrder.status !== 'pending') {
      throw new ConflictException(`FO must be in pending status. Current: ${fulfillmentOrder.status}`);
    }

    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId)
    });

    if (!batch) {
      throw new BadRequestException(`Outbound batch ${batchId} not found`);
    }

    if (batch.status !== 'created') {
      throw new ConflictException(`Batch must be in created status. Current: ${batch.status}`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'allocated',
          batchId,
          allocatedAt: new Date()
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      const currentBatchItems = await tx.query.outboundBatches.findFirst({
        where: eq(wmsTables.outboundBatches.id, batchId),
        columns: { totalItems: true, totalQty: true }
      });

      await tx.update(wmsTables.outboundBatches)
        .set({
          totalItems: (currentBatchItems?.totalItems || 0) + fulfillmentOrder.totalItems,
          totalQty: (currentBatchItems?.totalQty || 0) + fulfillmentOrder.totalQty
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Allocated FO ${fulfillmentOrderId} to batch ${batchId}`);
    });
  }

  private async validateItems(items: CreateFulfillmentOrderDto['items'], warehouseId: string): Promise<void> {
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

      const mapping = await this.productSkuMappingService.getActiveMapping(item.productId, warehouseId);
      if (!mapping) {
        throw new BadRequestException(`No active mapping found for product ${item.productId} in warehouse ${warehouseId}`);
      }

      const hasVariant = mapping.mappings.some(m => m.variantId === item.variantId);
      if (!hasVariant) {
        throw new BadRequestException(`Variant ${item.variantId} not found in product ${item.productId} mapping`);
      }
    }
  }

  private async getActiveMappingId(productId: string, warehouseId: string, tx: any): Promise<string> {
    const mapping = await tx.query.productSkuMappings.findFirst({
      where: and(
        eq(wmsTables.productSkuMappings.productId, productId),
        eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
        eq(wmsTables.productSkuMappings.isActive, true)
      )
    });

    if (!mapping) {
      throw new BadRequestException(`No active mapping for product ${productId} in warehouse ${warehouseId}`);
    }

    return mapping.id;
  }

  private async checkStockAvailability(skuId: string, warehouseId: string, tx: any): Promise<number> {
    const stock = await tx.query.stocks.findFirst({
      where: and(
        eq(wmsTables.stocks.skuId, skuId),
        eq(wmsTables.stocks.warehouseId, warehouseId)
      )
    });

    if (!stock) {
      return 0;
    }

    const reservations = await tx.query.stockReservations.findMany({
      where: and(
        eq(wmsTables.stockReservations.skuId, skuId),
        eq(wmsTables.stockReservations.warehouseId, warehouseId),
        eq(wmsTables.stockReservations.status, 'active')
      )
    });

    const totalReserved = reservations.reduce((sum, r) => sum + r.qty, 0);
    return Math.max(0, stock.quantity - totalReserved);
  }
}