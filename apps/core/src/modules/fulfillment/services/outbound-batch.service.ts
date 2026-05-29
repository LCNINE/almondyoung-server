import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, inArray, isNull, desc, lt, sql } from 'drizzle-orm';

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
      salesOrderId: string | null;
      salesOrderLineId: string | null;
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
    salesOrderId: string | null;
    salesOrderLineId: string | null;
    qty: number;
    pickedQty: number;
  }>;
}

@Injectable()
export class OutboundBatchService {
  private readonly logger = new Logger(OutboundBatchService.name);

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async createBatch(dto: CreateOutboundBatchDto, tx?: DbTx): Promise<string> {
    const { warehouseId, pickingMethod, name, scheduledPickingAt } = dto;

    return this.inTx(async (trx) => {
      const batchName = name || `배치-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const batchNumber = `OB-${new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, '')
        .slice(0, 14)}`;

      const [batch] = await trx
        .insert(wmsTables.outboundBatches)
        .values({
          name: batchName,
          batchNumber,
          warehouseId,
          pickingMethod,
          status: 'created',
          totalItems: 0,
          totalQty: 0,
          scheduledPickingAt,
        })
        .returning();

      this.logger.log(`Created outbound batch ${batch.id} with picking method: ${pickingMethod}`);
      return batch.id;
    }, tx);
  }

  async addFulfillmentOrdersToBatch(batchId: string, fulfillmentOrderIds: string[], tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const batchRows = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          status: wmsTables.outboundBatches.status,
          totalItems: wmsTables.outboundBatches.totalItems,
          totalQty: wmsTables.outboundBatches.totalQty,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);

      const batch = batchRows[0];
      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      if (batch.status !== 'created') {
        throw new ConflictException(`Cannot add FOs to batch in status: ${batch.status}`);
      }

      const fulfillmentOrders = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          status: wmsTables.fulfillmentOrders.status,
          batchId: wmsTables.fulfillmentOrders.batchId,
          fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
          totalItems: wmsTables.fulfillmentOrders.totalItems,
          totalQty: wmsTables.fulfillmentOrders.totalQty,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(
          and(
            inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds),
            inArray(wmsTables.fulfillmentOrders.status, ['ready', 'pending']),
            isNull(wmsTables.fulfillmentOrders.batchId),
          ),
        );

      if (fulfillmentOrders.length !== fulfillmentOrderIds.length) {
        throw new BadRequestException('Some fulfillment orders are not available for batching');
      }

      const directShipFOs = fulfillmentOrders.filter((fo) => fo.fulfillmentMode === 'drop_ship');
      if (directShipFOs.length > 0) {
        throw new BadRequestException(
          `Direct ship FOs cannot be added to batches: ${directShipFOs.map((fo) => fo.id).join(', ')}`,
        );
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'allocated',
          batchId,
          allocatedAt: new Date(),
        })
        .where(inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds));

      const totalItems = fulfillmentOrders.reduce((sum, fo) => sum + (fo.totalItems ?? 0), 0);
      const totalQty = fulfillmentOrders.reduce((sum, fo) => sum + (fo.totalQty ?? 0), 0);

      await trx
        .update(wmsTables.outboundBatches)
        .set({
          totalItems: (batch.totalItems ?? 0) + totalItems,
          totalQty: (batch.totalQty ?? 0) + totalQty,
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Added ${fulfillmentOrderIds.length} FOs to batch ${batchId}`);
    }, tx);
  }

  async removeFulfillmentOrderFromBatch(batchId: string, fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const batchRows = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          status: wmsTables.outboundBatches.status,
          totalItems: wmsTables.outboundBatches.totalItems,
          totalQty: wmsTables.outboundBatches.totalQty,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];

      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      if (batch.status === 'completed' || batch.status === 'canceled') {
        throw new ConflictException(`Cannot remove FO from batch in status: ${batch.status}`);
      }

      const foRows = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          totalItems: wmsTables.fulfillmentOrders.totalItems,
          totalQty: wmsTables.fulfillmentOrders.totalQty,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(
          and(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId), eq(wmsTables.fulfillmentOrders.batchId, batchId)),
        )
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new NotFoundException(`FO ${fulfillmentOrderId} not found in batch ${batchId}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'ready',
          batchId: null,
          allocatedAt: null,
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      await trx
        .update(wmsTables.outboundBatches)
        .set({
          totalItems: (batch.totalItems ?? 0) - (fulfillmentOrder.totalItems ?? 0),
          totalQty: (batch.totalQty ?? 0) - (fulfillmentOrder.totalQty ?? 0),
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Removed FO ${fulfillmentOrderId} from batch ${batchId}`);
    }, tx);
  }

  async startPicking(batchId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const batchRows = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          status: wmsTables.outboundBatches.status,
          totalItems: wmsTables.outboundBatches.totalItems,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];

      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      if (batch.status !== 'created') {
        throw new ConflictException(`Cannot start picking for batch in status: ${batch.status}`);
      }

      if (batch.totalItems === 0) {
        throw new BadRequestException('Cannot start picking for empty batch');
      }

      await trx
        .update(wmsTables.outboundBatches)
        .set({
          status: 'picking',
          startedAt: new Date(),
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'picking' })
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      this.logger.log(`Started picking for batch ${batchId}`);
    }, tx);
  }

  async completeBatch(batchId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const batchRows = await trx
        .select({ id: wmsTables.outboundBatches.id, status: wmsTables.outboundBatches.status })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];

      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      if (batch.status !== 'picking') {
        throw new ConflictException(`Cannot complete batch in status: ${batch.status}`);
      }

      const incompleteCountRows = await trx
        .select({ id: wmsTables.fulfillmentOrderItems.id })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(
          and(
            eq(wmsTables.fulfillmentOrders.batchId, batchId),
            lt(wmsTables.fulfillmentOrderItems.pickedQty, wmsTables.fulfillmentOrderItems.qty),
          ),
        );

      const incompleteItemsCount = incompleteCountRows.length;
      if (incompleteItemsCount > 0) {
        throw new ConflictException(`Cannot complete batch with ${incompleteItemsCount} incomplete items`);
      }

      await trx
        .update(wmsTables.outboundBatches)
        .set({
          status: 'completed',
          completedAt: new Date(),
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'picked' })
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      this.logger.log(`Completed batch ${batchId}`);
    }, tx);
  }

  async cancelBatch(batchId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const batchRows = await trx
        .select({ id: wmsTables.outboundBatches.id, status: wmsTables.outboundBatches.status })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];

      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      if (batch.status === 'completed') {
        throw new ConflictException('Cannot cancel completed batch');
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'ready',
          batchId: null,
          allocatedAt: null,
        })
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      await trx
        .update(wmsTables.outboundBatches)
        .set({
          status: 'canceled',
          canceledAt: new Date(),
        })
        .where(eq(wmsTables.outboundBatches.id, batchId));

      this.logger.log(`Canceled batch ${batchId}`);
    }, tx);
  }

  async getBatchDetail(batchId: string, tx?: DbTx): Promise<OutboundBatchDetail> {
    return this.inTx(async (trx) => {
      const batchRows = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          name: wmsTables.outboundBatches.name,
          warehouseId: wmsTables.outboundBatches.warehouseId,
          pickingMethod: wmsTables.outboundBatches.pickingMethod,
          status: wmsTables.outboundBatches.status,
          totalItems: wmsTables.outboundBatches.totalItems,
          totalQty: wmsTables.outboundBatches.totalQty,
          scheduledPickingAt: wmsTables.outboundBatches.scheduledPickingAt,
          startedAt: wmsTables.outboundBatches.startedAt,
          completedAt: wmsTables.outboundBatches.completedAt,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);

      const batch = batchRows[0];
      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      const fos = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          status: wmsTables.fulfillmentOrders.status,
          priority: wmsTables.fulfillmentOrders.priority,
          totalItems: wmsTables.fulfillmentOrders.totalItems,
          totalQty: wmsTables.fulfillmentOrders.totalQty,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      const foIds = fos.map((fo) => fo.id);
      const items =
        foIds.length === 0
          ? []
          : await trx
              .select({
                id: wmsTables.fulfillmentOrderItems.id,
                fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
                salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
                salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
                skuId: wmsTables.fulfillmentOrderItems.skuId,
                qty: wmsTables.fulfillmentOrderItems.qty,
                pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
              })
              .from(wmsTables.fulfillmentOrderItems)
              .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foIds));

      return {
        id: batch.id,
        name: batch.name ?? '',
        warehouseId: batch.warehouseId,
        pickingMethod: batch.pickingMethod,
        status: batch.status,
        totalItems: batch.totalItems ?? 0,
        totalQty: batch.totalQty ?? 0,
        scheduledPickingAt: batch.scheduledPickingAt ?? undefined,
        startedAt: batch.startedAt ?? undefined,
        completedAt: batch.completedAt ?? undefined,
        fulfillmentOrders: fos.map((fo) => ({
          id: fo.id,
          status: fo.status,
          priority: fo.priority ?? 'normal',
          totalItems: fo.totalItems ?? 0,
          totalQty: fo.totalQty ?? 0,
          items: items
            .filter((i) => i.fulfillmentOrderId === fo.id)
            .map((i) => ({
              id: i.id,
              salesOrderId: i.salesOrderId,
              salesOrderLineId: i.salesOrderLineId,
              skuId: i.skuId,
              qty: i.qty,
              pickedQty: i.pickedQty,
            })),
        })),
      };
    }, tx);
  }

  async generatePickingList(batchId: string, tx?: DbTx): Promise<PickingListItem[]> {
    return this.inTx(async (trx) => {
      const batchRows = await trx
        .select({ id: wmsTables.outboundBatches.id })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];
      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      const rows = await trx
        .select({
          foiId: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
          salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          skuName: wmsTables.skus.name,
          locationCode: wmsTables.locations.code,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .leftJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.skus.primaryLocationId))
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      const skuMap = new Map<string, PickingListItem>();
      for (const row of rows) {
        if (!skuMap.has(row.skuId)) {
          skuMap.set(row.skuId, {
            skuId: row.skuId,
            skuName: row.skuName,
            locationCode: row.locationCode ?? undefined,
            totalQty: 0,
            fulfillmentOrderItems: [],
          });
        }
        const skuItem = skuMap.get(row.skuId)!;
        skuItem.totalQty += row.qty;
        skuItem.fulfillmentOrderItems.push({
          foiId: row.foiId,
          fulfillmentOrderId: row.fulfillmentOrderId,
          salesOrderId: row.salesOrderId,
          salesOrderLineId: row.salesOrderLineId,
          qty: row.qty,
          pickedQty: row.pickedQty,
        });
      }

      return Array.from(skuMap.values()).sort((a, b) => a.skuName.localeCompare(b.skuName));
    }, tx);
  }

  async getAvailableFulfillmentOrders(
    warehouseId: string,
    tx?: DbTx,
  ): Promise<
    Array<{
      id: string;
      priority: string;
      fulfillmentMode: string;
      totalItems: number;
      totalQty: number;
      createdAt: Date;
    }>
  > {
    return this.inTx(async (trx) => {
      const fulfillmentOrders = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          priority: wmsTables.fulfillmentOrders.priority,
          fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
          totalItems: wmsTables.fulfillmentOrders.totalItems,
          totalQty: wmsTables.fulfillmentOrders.totalQty,
          createdAt: wmsTables.fulfillmentOrders.createdAt,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(
          and(
            eq(wmsTables.fulfillmentOrders.warehouseId, warehouseId),
            inArray(wmsTables.fulfillmentOrders.status, ['ready', 'pending']),
            isNull(wmsTables.fulfillmentOrders.batchId),
          ),
        )
        .orderBy(
          // pgEnum 알파벳 정렬을 우회해 urgent→high→normal 명시 순서 보장
          sql`CASE ${wmsTables.fulfillmentOrders.priority}
                WHEN 'urgent' THEN 0
                WHEN 'high'   THEN 1
                WHEN 'normal' THEN 2
                ELSE 3
              END`,
          desc(wmsTables.fulfillmentOrders.createdAt),
        );

      return fulfillmentOrders
        .filter((fo) => fo.fulfillmentMode !== 'drop_ship')
        .map((fo) => ({
          id: fo.id,
          priority: fo.priority ?? 'normal',
          fulfillmentMode: fo.fulfillmentMode ?? 'in_house',
          totalItems: fo.totalItems ?? 0,
          totalQty: fo.totalQty ?? 0,
          createdAt: fo.createdAt,
        }));
    }, tx);
  }

  async getBatches(
    warehouseId?: string,
    tx?: DbTx,
  ): Promise<
    Array<{
      id: string;
      name: string;
      warehouseId: string;
      pickingMethod: string;
      status: string;
      totalItems: number;
      totalQty: number;
      scheduledPickingAt?: Date;
      createdAt: Date;
    }>
  > {
    return this.inTx(async (trx) => {
      const batches = await (warehouseId
        ? trx
            .select({
              id: wmsTables.outboundBatches.id,
              name: wmsTables.outboundBatches.name,
              warehouseId: wmsTables.outboundBatches.warehouseId,
              pickingMethod: wmsTables.outboundBatches.pickingMethod,
              status: wmsTables.outboundBatches.status,
              totalItems: wmsTables.outboundBatches.totalItems,
              totalQty: wmsTables.outboundBatches.totalQty,
              scheduledPickingAt: wmsTables.outboundBatches.scheduledPickingAt,
              createdAt: wmsTables.outboundBatches.createdAt,
            })
            .from(wmsTables.outboundBatches)
            .where(eq(wmsTables.outboundBatches.warehouseId, warehouseId))
            .orderBy(desc(wmsTables.outboundBatches.createdAt))
        : trx
            .select({
              id: wmsTables.outboundBatches.id,
              name: wmsTables.outboundBatches.name,
              warehouseId: wmsTables.outboundBatches.warehouseId,
              pickingMethod: wmsTables.outboundBatches.pickingMethod,
              status: wmsTables.outboundBatches.status,
              totalItems: wmsTables.outboundBatches.totalItems,
              totalQty: wmsTables.outboundBatches.totalQty,
              scheduledPickingAt: wmsTables.outboundBatches.scheduledPickingAt,
              createdAt: wmsTables.outboundBatches.createdAt,
            })
            .from(wmsTables.outboundBatches)
            .orderBy(desc(wmsTables.outboundBatches.createdAt)));

      return batches.map((batch) => ({
        id: batch.id,
        name: batch.name ?? '',
        warehouseId: batch.warehouseId,
        pickingMethod: batch.pickingMethod,
        status: batch.status,
        totalItems: batch.totalItems ?? 0,
        totalQty: batch.totalQty ?? 0,
        scheduledPickingAt: batch.scheduledPickingAt ?? undefined,
        createdAt: batch.createdAt,
      }));
    }, tx);
  }
}
