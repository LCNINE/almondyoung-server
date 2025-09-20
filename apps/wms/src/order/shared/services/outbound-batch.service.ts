import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, inArray, isNull, desc } from 'drizzle-orm';

export interface CreateOutboundBatchDto {
  warehouseId: string;
  pickingMethod: 'individual' | 'total_picking';
  name?: string;
  scheduledPickingAt?: Date;
}

export interface OutboundBatchDetail {
  id: string;
  name: string;
  warehouseId: string;
  pickingMethod: 'individual' | 'total_picking';
  status: 'created' | 'picking' | 'completed' | 'canceled';
  totalItems: number;
  totalQty: number;
  scheduledPickingAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  fulfillmentOrders: Array<{
    id: string;
    status: string;
    priority: string;
    totalItems: number;
    totalQty: number;
    items: Array<{
      id: string;
      salesOrderId: string;
      salesOrderLineId: string;
      skuId: string;
      qty: number;
      pickedQty: number;
    }>;
  }>;
}

export interface PickingListItem {
  skuId: string;
  skuName: string;
  locationCode?: string;
  totalQty: number;
  fulfillmentOrderItems: Array<{
    foiId: string;
    fulfillmentOrderId: string;
    salesOrderId: string;
    salesOrderLineId: string;
    qty: number;
    pickedQty: number;
  }>;
}

@Injectable()
export class OutboundBatchService {
  private readonly logger = new Logger(OutboundBatchService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async createBatch(dto: CreateOutboundBatchDto): Promise<string> {
    const { warehouseId, pickingMethod, name, scheduledPickingAt } = dto;

    const batchName = name || `배치-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

    const [batch] = await this.db.insert(wmsTables.outboundBatches)
      .values({
        name: batchName,
        warehouseId,
        pickingMethod,
        status: 'created',
        totalItems: 0,
        totalQty: 0,
        scheduledPickingAt
      })
      .returning();

    this.logger.log(`Created outbound batch ${batch.id} with picking method: ${pickingMethod}`);
    return batch.id;
  }

  async addFulfillmentOrdersToBatch(batchId: string, fulfillmentOrderIds: string[]): Promise<void> {
    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId)
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    if (batch.status !== 'created') {
      throw new ConflictException(`Cannot add FOs to batch in status: ${batch.status}`);
    }

    const fulfillmentOrders = await this.db.query.fulfillmentOrders.findMany({
      where: and(
        inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds),
        eq(wmsTables.fulfillmentOrders.status, 'pending'),
        isNull(wmsTables.fulfillmentOrders.batchId)
      )
    });

    if (fulfillmentOrders.length !== fulfillmentOrderIds.length) {
      throw new BadRequestException('Some fulfillment orders are not available for batching');
    }

    const directShipFOs = fulfillmentOrders.filter(fo => fo.fulfillmentMode === 'direct_ship');
    if (directShipFOs.length > 0) {
      throw new BadRequestException(`Direct ship FOs cannot be added to batches: ${directShipFOs.map(fo => fo.id).join(', ')}`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'allocated',
          batchId,
          allocatedAt: new Date()
        })
        .where(inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds));

      const totalItems = fulfillmentOrders.reduce((sum, fo) => sum + fo.totalItems, 0);
      const totalQty = fulfillmentOrders.reduce((sum, fo) => sum + fo.totalQty, 0);

      await tx.update(wmsTables.outboundBatches)
        .set({
          totalItems: batch.totalItems + totalItems,
          totalQty: batch.totalQty + totalQty
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Added ${fulfillmentOrderIds.length} FOs to batch ${batchId}`);
    });
  }

  async removeFulfillmentOrderFromBatch(batchId: string, fulfillmentOrderId: string): Promise<void> {
    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId)
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    if (batch.status === 'completed' || batch.status === 'canceled') {
      throw new ConflictException(`Cannot remove FO from batch in status: ${batch.status}`);
    }

    const fulfillmentOrder = await this.db.query.fulfillmentOrders.findFirst({
      where: and(
        eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
        eq(wmsTables.fulfillmentOrders.batchId, batchId)
      )
    });

    if (!fulfillmentOrder) {
      throw new NotFoundException(`FO ${fulfillmentOrderId} not found in batch ${batchId}`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'pending',
          batchId: null,
          allocatedAt: null
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      await tx.update(wmsTables.outboundBatches)
        .set({
          totalItems: batch.totalItems - fulfillmentOrder.totalItems,
          totalQty: batch.totalQty - fulfillmentOrder.totalQty
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Removed FO ${fulfillmentOrderId} from batch ${batchId}`);
    });
  }

  async startPicking(batchId: string): Promise<void> {
    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId)
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    if (batch.status !== 'created') {
      throw new ConflictException(`Cannot start picking for batch in status: ${batch.status}`);
    }

    if (batch.totalItems === 0) {
      throw new BadRequestException('Cannot start picking for empty batch');
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.outboundBatches)
        .set({
          status: 'picking',
          startedAt: new Date()
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      await tx.update(wmsTables.fulfillmentOrders)
        .set({ status: 'picking' })
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      this.logger.log(`Started picking for batch ${batchId}`);
    });
  }

  async completeBatch(batchId: string): Promise<void> {
    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId),
      with: {
        fulfillmentOrders: {
          with: {
            items: true
          }
        }
      }
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    if (batch.status !== 'picking') {
      throw new ConflictException(`Cannot complete batch in status: ${batch.status}`);
    }

    const incompleteItems = batch.fulfillmentOrders
      .flatMap(fo => fo.items)
      .filter(item => item.pickedQty < item.qty);

    if (incompleteItems.length > 0) {
      throw new ConflictException(`Cannot complete batch with ${incompleteItems.length} incomplete items`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.outboundBatches)
        .set({
          status: 'completed',
          completedAt: new Date()
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      await tx.update(wmsTables.fulfillmentOrders)
        .set({ status: 'picked' })
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      this.logger.log(`Completed batch ${batchId}`);
    });
  }

  async cancelBatch(batchId: string): Promise<void> {
    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId)
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    if (batch.status === 'completed') {
      throw new ConflictException('Cannot cancel completed batch');
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'pending',
          batchId: null,
          allocatedAt: null
        })
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      await tx.update(wmsTables.outboundBatches)
        .set({
          status: 'canceled',
          canceledAt: new Date()
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Canceled batch ${batchId}`);
    });
  }

  async getBatchDetail(batchId: string): Promise<OutboundBatchDetail> {
    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId),
      with: {
        fulfillmentOrders: {
          with: {
            items: {
              with: {
                sku: true
              }
            }
          }
        }
      }
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    return {
      id: batch.id,
      name: batch.name,
      warehouseId: batch.warehouseId,
      pickingMethod: batch.pickingMethod,
      status: batch.status,
      totalItems: batch.totalItems,
      totalQty: batch.totalQty,
      scheduledPickingAt: batch.scheduledPickingAt,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      fulfillmentOrders: batch.fulfillmentOrders.map(fo => ({
        id: fo.id,
        status: fo.status,
        priority: fo.priority,
        totalItems: fo.totalItems,
        totalQty: fo.totalQty,
        items: fo.items.map(item => ({
          id: item.id,
          salesOrderId: item.salesOrderId,
          salesOrderLineId: item.salesOrderLineId,
          skuId: item.skuId,
          qty: item.qty,
          pickedQty: item.pickedQty
        }))
      }))
    };
  }

  async generatePickingList(batchId: string): Promise<PickingListItem[]> {
    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId),
      with: {
        fulfillmentOrders: {
          with: {
            items: {
              with: {
                sku: true
              }
            }
          }
        }
      }
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    const skuMap = new Map<string, PickingListItem>();

    for (const fo of batch.fulfillmentOrders) {
      for (const item of fo.items) {
        const skuId = item.skuId;

        if (!skuMap.has(skuId)) {
          skuMap.set(skuId, {
            skuId,
            skuName: item.sku.name,
            locationCode: undefined, // TODO: Get from location service
            totalQty: 0,
            fulfillmentOrderItems: []
          });
        }

        const skuItem = skuMap.get(skuId)!;
        skuItem.totalQty += item.qty;
        skuItem.fulfillmentOrderItems.push({
          foiId: item.id,
          fulfillmentOrderId: fo.id,
          salesOrderId: item.salesOrderId,
          salesOrderLineId: item.salesOrderLineId,
          qty: item.qty,
          pickedQty: item.pickedQty
        });
      }
    }

    return Array.from(skuMap.values()).sort((a, b) => a.skuName.localeCompare(b.skuName));
  }

  async getAvailableFulfillmentOrders(warehouseId: string): Promise<Array<{
    id: string;
    priority: string;
    fulfillmentMode: string;
    totalItems: number;
    totalQty: number;
    createdAt: Date;
  }>> {
    const fulfillmentOrders = await this.db.query.fulfillmentOrders.findMany({
      where: and(
        eq(wmsTables.fulfillmentOrders.warehouseId, warehouseId),
        eq(wmsTables.fulfillmentOrders.status, 'pending'),
        isNull(wmsTables.fulfillmentOrders.batchId)
      ),
      orderBy: [desc(wmsTables.fulfillmentOrders.priority), desc(wmsTables.fulfillmentOrders.createdAt)]
    });

    return fulfillmentOrders
      .filter(fo => fo.fulfillmentMode !== 'direct_ship')
      .map(fo => ({
        id: fo.id,
        priority: fo.priority,
        fulfillmentMode: fo.fulfillmentMode,
        totalItems: fo.totalItems,
        totalQty: fo.totalQty,
        createdAt: fo.createdAt!
      }));
  }

  async getBatches(warehouseId?: string): Promise<Array<{
    id: string;
    name: string;
    warehouseId: string;
    pickingMethod: string;
    status: string;
    totalItems: number;
    totalQty: number;
    scheduledPickingAt?: Date;
    createdAt: Date;
  }>> {
    const batches = await this.db.query.outboundBatches.findMany({
      where: warehouseId ? eq(wmsTables.outboundBatches.warehouseId, warehouseId) : undefined,
      orderBy: desc(wmsTables.outboundBatches.createdAt)
    });

    return batches.map(batch => ({
      id: batch.id,
      name: batch.name,
      warehouseId: batch.warehouseId,
      pickingMethod: batch.pickingMethod,
      status: batch.status,
      totalItems: batch.totalItems,
      totalQty: batch.totalQty,
      scheduledPickingAt: batch.scheduledPickingAt,
      createdAt: batch.createdAt!
    }));
  }
}