import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { BarcodeService, FOIScanResult, SkuScanResult } from '../../inventory/shared/services/barcode.service';

export interface PickingOperation {
  batchId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  locationCode?: string;
  totalQty: number;
  pickedQty: number;
  remainingQty: number;
  foiDetails: Array<{
    foiId: string;
    fulfillmentOrderId: string;
    salesOrderId: string | null;
    salesOrderLineId: string | null;
    requiredQty: number;
    pickedQty: number;
    remainingQty: number;
  }>;
}

export interface PickItemRequest {
  batchId: string;
  skuId: string;
  pickedQty: number;
  locationCode?: string;
  pickerUserId?: string;
}

export interface PickingProgress {
  batchId: string;
  totalSkus: number;
  completedSkus: number;
  totalItems: number;
  pickedItems: number;
  remainingItems: number;
  completionPercentage: number;
}

export interface IndividualPickingSession {
  fulfillmentOrderId: string;
  items: Array<{
    foiId: string;
    skuId: string;
    skuCode: string;
    skuName: string;
    requiredQty: number;
    pickedQty: number;
    locationCode?: string;
    isCompleted: boolean;
  }>;
  totalItems: number;
  completedItems: number;
  completionPercentage: number;
}

@Injectable()
export class PickingProcessService {
  private readonly logger = new Logger(PickingProcessService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly barcodeService: BarcodeService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async getPickingOperations(batchId: string, tx?: DbTx): Promise<PickingOperation[]> {
    return this.inTx(async (trx) => {
      const batchRows = await trx
        .select({ id: wmsTables.outboundBatches.id, pickingMethod: wmsTables.outboundBatches.pickingMethod })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);

      const batch = batchRows[0];
      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }
      if (batch.pickingMethod === 'total_picking') {
        throw new BadRequestException('total_picking flow is not yet supported');
      }

      const itemRows = await trx
        .select({
          foId: wmsTables.fulfillmentOrders.id,
          itemId: wmsTables.fulfillmentOrderItems.id,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          skuCode: wmsTables.skus.code,
          skuName: wmsTables.skus.name,
          salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      const skuOperations = new Map<string, PickingOperation>();

      for (const row of itemRows) {
        const skuId = row.skuId;

        if (!skuOperations.has(skuId)) {
          skuOperations.set(skuId, {
            batchId,
            skuId,
            skuCode: row.skuCode,
            skuName: row.skuName,
            locationCode: undefined,
            totalQty: 0,
            pickedQty: 0,
            remainingQty: 0,
            foiDetails: [],
          });
        }

        const operation = skuOperations.get(skuId)!;
        operation.totalQty += row.qty;
        operation.pickedQty += row.pickedQty;
        operation.remainingQty = operation.totalQty - operation.pickedQty;

        operation.foiDetails.push({
          foiId: row.itemId,
          fulfillmentOrderId: row.foId,
          salesOrderId: row.salesOrderId,
          salesOrderLineId: row.salesOrderLineId,
          requiredQty: row.qty,
          pickedQty: row.pickedQty,
          remainingQty: row.qty - row.pickedQty,
        });
      }

      return Array.from(skuOperations.values()).sort((a, b) =>
        (a.locationCode || '').localeCompare(b.locationCode || ''),
      );
    }, tx);
  }

  async pickItem(request: PickItemRequest, tx?: DbTx): Promise<void> {
    const { batchId, skuId, pickedQty, locationCode, pickerUserId } = request;

    if (pickedQty <= 0) {
      throw new BadRequestException('Picked quantity must be positive');
    }

    await this.inTx(async (trx) => {
      const batchRows = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          status: wmsTables.outboundBatches.status,
          pickingMethod: wmsTables.outboundBatches.pickingMethod,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      const batch = batchRows[0];

      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }

      if (batch.pickingMethod === 'total_picking') {
        throw new BadRequestException('total_picking flow is not yet supported');
      }

      if (batch.status !== 'picking') {
        throw new ConflictException(`Cannot pick items from batch in status: ${batch.status}`);
      }

      const fulfillmentOrderItems = await trx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          and(
            eq(wmsTables.fulfillmentOrderItems.skuId, skuId),
            inArray(
              wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
              trx
                .select({ id: wmsTables.fulfillmentOrders.id })
                .from(wmsTables.fulfillmentOrders)
                .where(eq(wmsTables.fulfillmentOrders.batchId, batchId)),
            ),
          ),
        )
        .orderBy(wmsTables.fulfillmentOrderItems.createdAt);

      if (fulfillmentOrderItems.length === 0) {
        throw new NotFoundException(`No items found for SKU ${skuId} in batch ${batchId}`);
      }

      const totalRequired = fulfillmentOrderItems.reduce((sum, item) => sum + item.qty, 0);
      const totalPicked = fulfillmentOrderItems.reduce((sum, item) => sum + item.pickedQty, 0);
      const totalRemaining = totalRequired - totalPicked;

      if (pickedQty > totalRemaining) {
        throw new BadRequestException(
          `Picked quantity ${pickedQty} exceeds remaining quantity ${totalRemaining} for SKU ${skuId}`,
        );
      }

      let remainingToDistribute = pickedQty;

      for (const item of fulfillmentOrderItems) {
        if (remainingToDistribute <= 0) break;

        const itemRemaining = item.qty - item.pickedQty;
        if (itemRemaining <= 0) continue;

        const toPickForItem = Math.min(remainingToDistribute, itemRemaining);

        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({
            pickedQty: item.pickedQty + toPickForItem,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));

        remainingToDistribute -= toPickForItem;
      }

      this.logger.log(
        `Picked ${pickedQty} units of SKU ${skuId} for batch ${batchId}` +
          (pickerUserId ? ` by user ${pickerUserId}` : '') +
          (locationCode ? ` from location ${locationCode}` : ''),
      );
    }, tx);
  }

  async getPickingProgress(batchId: string, tx?: DbTx): Promise<PickingProgress> {
    return this.inTx(async (trx) => {
      const batchRows = await trx
        .select({ id: wmsTables.outboundBatches.id, pickingMethod: wmsTables.outboundBatches.pickingMethod })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);

      const batch = batchRows[0];
      if (!batch) {
        throw new NotFoundException(`Outbound batch ${batchId} not found`);
      }
      if (batch.pickingMethod === 'total_picking') {
        throw new BadRequestException('total_picking flow is not yet supported');
      }

      const items = await trx
        .select({
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(eq(wmsTables.fulfillmentOrders.batchId, batchId));

      const skuGroups = new Map<string, { total: number; picked: number }>();

      for (const item of items) {
        if (!skuGroups.has(item.skuId)) {
          skuGroups.set(item.skuId, { total: 0, picked: 0 });
        }
        const group = skuGroups.get(item.skuId)!;
        group.total += item.qty;
        group.picked += item.pickedQty;
      }

      const completedSkus = Array.from(skuGroups.values()).filter((group) => group.picked >= group.total).length;
      const totalItems = items.reduce((sum, item) => sum + item.qty, 0);
      const pickedItems = items.reduce((sum, item) => sum + item.pickedQty, 0);

      return {
        batchId,
        totalSkus: skuGroups.size,
        completedSkus,
        totalItems,
        pickedItems,
        remainingItems: totalItems - pickedItems,
        completionPercentage: totalItems > 0 ? Math.round((pickedItems / totalItems) * 100) : 0,
      };
    }, tx);
  }

  async startIndividualPicking(fulfillmentOrderId: string, tx?: DbTx): Promise<IndividualPickingSession> {
    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);

      const fo = foRows[0];
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      if (fo.status !== 'allocated' && fo.status !== 'picking') {
        throw new ConflictException(`Cannot start individual picking for FO in status: ${fo.status}`);
      }

      if (fo.status === 'allocated') {
        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'picking' })
          .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
      }

      const itemRows = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          skuCode: wmsTables.skus.code,
          skuName: wmsTables.skus.name,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      const completedItems = itemRows.filter((i) => i.pickedQty >= i.qty).length;

      return {
        fulfillmentOrderId,
        items: itemRows.map((item) => ({
          foiId: item.id,
          skuId: item.skuId,
          skuCode: item.skuCode,
          skuName: item.skuName,
          requiredQty: item.qty,
          pickedQty: item.pickedQty,
          locationCode: undefined,
          isCompleted: item.pickedQty >= item.qty,
        })),
        totalItems: itemRows.length,
        completedItems,
        completionPercentage: itemRows.length > 0 ? Math.round((completedItems / itemRows.length) * 100) : 0,
      };
    }, tx);
  }

  async getIndividualPickingSession(fulfillmentOrderId: string): Promise<IndividualPickingSession> {
    const foRows = await this.db
      .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
      .limit(1);

    const fo = foRows[0];
    if (!fo) {
      throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    if (fo.status !== 'picking') {
      throw new NotFoundException(`No active picking session for fulfillment order ${fulfillmentOrderId}`);
    }

    const itemRows = await this.db
      .select({
        id: wmsTables.fulfillmentOrderItems.id,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
        qty: wmsTables.fulfillmentOrderItems.qty,
        pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        skuCode: wmsTables.skus.code,
        skuName: wmsTables.skus.name,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

    const completedItems = itemRows.filter((i) => i.pickedQty >= i.qty).length;

    return {
      fulfillmentOrderId,
      items: itemRows.map((item) => ({
        foiId: item.id,
        skuId: item.skuId,
        skuCode: item.skuCode,
        skuName: item.skuName,
        requiredQty: item.qty,
        pickedQty: item.pickedQty,
        locationCode: undefined,
        isCompleted: item.pickedQty >= item.qty,
      })),
      totalItems: itemRows.length,
      completedItems,
      completionPercentage: itemRows.length > 0 ? Math.round((completedItems / itemRows.length) * 100) : 0,
    };
  }

  async pickIndividualItem(foiId: string, pickedQty: number, pickerUserId?: string, tx?: DbTx): Promise<void> {
    if (pickedQty <= 0) {
      throw new BadRequestException('Picked quantity must be positive');
    }

    await this.inTx(async (trx) => {
      const rows = await trx
        .select({
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          foStatus: wmsTables.fulfillmentOrders.status,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId))
        .limit(1);

      const item = rows[0];
      if (!item) {
        throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
      }

      if (item.foStatus !== 'picking') {
        throw new ConflictException(`Cannot pick from FO in status: ${item.foStatus}`);
      }

      const newPickedQty = item.pickedQty + pickedQty;
      if (newPickedQty > item.qty) {
        throw new BadRequestException(
          `Picked quantity ${newPickedQty} exceeds required quantity ${item.qty} for item ${foiId}`,
        );
      }

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({
          pickedQty: newPickedQty,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      this.logger.log(
        `Individual pick: FOI ${foiId} picked ${pickedQty}, total: ${newPickedQty}/${item.qty}${pickerUserId ? `, picker: ${pickerUserId}` : ''}`,
      );
    }, tx);
  }

  async completeIndividualPicking(fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const items = await trx
        .select({ qty: wmsTables.fulfillmentOrderItems.qty, pickedQty: wmsTables.fulfillmentOrderItems.pickedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      if (!items || items.length === 0) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      const incompleteItems = items.filter((item) => item.pickedQty < item.qty);
      if (incompleteItems.length > 0) {
        throw new ConflictException(`Cannot complete picking with ${incompleteItems.length} incomplete items`);
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'picked',
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      this.logger.log(`Completed individual picking for FO ${fulfillmentOrderId}`);
    }, tx);
  }

  async resetPickingForItem(foiId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const rows = await trx
        .select({ foStatus: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId))
        .limit(1);

      const item = rows[0];
      if (!item) {
        throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
      }

      if (item.foStatus !== 'picking') {
        throw new ConflictException(`Cannot reset picking for FO in status: ${item.foStatus}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({
          pickedQty: 0,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      this.logger.log(`Reset picking for FOI ${foiId}`);
    }, tx);
  }

  async scanBarcode(
    barcode: string,
    context: {
      batchId?: string;
      fulfillmentOrderId?: string;
      warehouseId: string;
      pickerUserId?: string;
    },
    tx?: DbTx,
  ): Promise<{ type: string; data: unknown; actions: string[] }> {
    return this.inTx(async (trx) => {
      const parsed = this.barcodeService.parseBarcode(barcode);

      switch (parsed.type) {
        case 'sku': {
          const skuResult = await this.barcodeService.scanSku(barcode, context.warehouseId, trx);
          return this.handleSkuScan(skuResult, context, trx);
        }
        case 'fulfillment_order_item': {
          const foiResult = await this.barcodeService.scanFulfillmentOrderItem(barcode, trx);
          return this.handleFOIScan(foiResult, context, trx);
        }
        case 'fulfillment_order': {
          const foResult = await this.barcodeService.scanFulfillmentOrder(barcode, trx);
          return this.handleFOScan(foResult, context, trx);
        }
        case 'location':
          return this.handleLocationScan(parsed.id, context, trx);
        default:
          throw new BadRequestException(`Unknown barcode type: ${parsed.type}`);
      }
    }, tx);
  }

  private async handleSkuScan(
    skuResult: SkuScanResult,
    context: { batchId?: string; warehouseId: string },
    tx?: DbTx,
  ): Promise<{ type: string; data: unknown; actions: string[] }> {
    return this.inTx(async (trx) => {
      const { skuId, skuName, availableQty } = skuResult;
      const { batchId } = context;

      if (!batchId) {
        return {
          type: 'sku_info',
          data: skuResult,
          actions: ['view_stock', 'search_in_batches'],
        };
      }

      const operations = await this.getPickingOperations(batchId, trx);
      const skuOperation = operations.find((op) => op.skuId === skuId);

      if (!skuOperation) {
        return {
          type: 'sku_not_in_batch',
          data: { ...skuResult, batchId },
          actions: ['view_stock'],
        };
      }

      return {
        type: 'sku_pick_ready',
        data: { ...skuResult, batchId, operation: skuOperation },
        actions: ['pick_quantity', 'view_foi_details'],
      };
    }, tx);
  }

  private async handleFOIScan(
    foiResult: FOIScanResult,
    context: { fulfillmentOrderId?: string; batchId?: string },
    tx?: DbTx,
  ): Promise<{ type: string; data: unknown; actions: string[] }> {
    return this.inTx(async (trx) => {
      const { foiId, fulfillmentOrderId, remainingQty, batchId } = foiResult;

      if (remainingQty <= 0) {
        return { type: 'foi_completed', data: foiResult, actions: ['view_details'] };
      }

      if (context.fulfillmentOrderId && context.fulfillmentOrderId !== fulfillmentOrderId) {
        return { type: 'foi_wrong_order', data: foiResult, actions: ['view_details'] };
      }

      if (context.batchId && batchId !== context.batchId) {
        return { type: 'foi_wrong_batch', data: foiResult, actions: ['view_details'] };
      }

      return {
        type: 'foi_pick_ready',
        data: foiResult,
        actions: ['pick_quantity', 'view_details'],
      };
    }, tx);
  }

  private async handleFOScan(
    foResult: { fulfillmentOrderId: string; status: string; totalItems: number; completedItems: number },
    context: unknown,
    tx?: DbTx,
  ): Promise<{ type: string; data: unknown; actions: string[] }> {
    const { status } = foResult;

    if (status === 'picked') {
      return { type: 'fo_completed', data: foResult, actions: ['view_details', 'start_packing'] };
    }

    if (status !== 'picking' && status !== 'allocated') {
      return { type: 'fo_not_ready', data: foResult, actions: ['view_details'] };
    }

    return { type: 'fo_pick_ready', data: foResult, actions: ['start_individual_picking', 'view_items'] };
  }

  private async handleLocationScan(
    locationCode: string,
    context: { warehouseId: string },
    tx?: DbTx,
  ): Promise<{ type: string; data: unknown; actions: string[] }> {
    return this.inTx(async (trx) => {
      const isValid = await this.barcodeService.validateLocationAccess(locationCode, context.warehouseId, trx);

      if (!isValid) {
        return { type: 'location_access_denied', data: { locationCode }, actions: [] };
      }

      return { type: 'location_accessed', data: { locationCode }, actions: ['view_location_stock', 'scan_next_item'] };
    }, tx);
  }

  async pickByBarcodeScan(
    barcode: string,
    pickedQty: number,
    context: {
      batchId?: string;
      fulfillmentOrderId?: string;
      warehouseId: string;
      pickerUserId?: string;
      locationCode?: string;
    },
    tx?: DbTx,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    return this.inTx(async (trx) => {
      const parsed = this.barcodeService.parseBarcode(barcode);

      if (parsed.type === 'sku' && context.batchId) {
        await this.pickItem(
          {
            batchId: context.batchId,
            skuId: parsed.id,
            pickedQty,
            locationCode: context.locationCode,
            pickerUserId: context.pickerUserId,
          },
          trx,
        );

        return {
          success: true,
          message: `Picked ${pickedQty} units of SKU in batch`,
          data: { skuId: parsed.id, pickedQty },
        };
      } else if (parsed.type === 'fulfillment_order_item') {
        await this.pickIndividualItem(parsed.id, pickedQty, context.pickerUserId, trx);

        return {
          success: true,
          message: `Picked ${pickedQty} units for specific order item`,
          data: { foiId: parsed.id, pickedQty },
        };
      } else {
        throw new BadRequestException(`Invalid barcode for picking: ${barcode}`);
      }
    }, tx);
  }

  async getBarcodeForPicking(request: {
    type: 'sku' | 'foi' | 'fo';
    id: string;
  }): Promise<{ barcode: string; label?: string }> {
    switch (request.type) {
      case 'sku':
        return {
          barcode: this.barcodeService.generateSkuBarcode(request.id),
          label: `SKU-${request.id}`,
        };
      case 'foi':
        return {
          barcode: this.barcodeService.generateFulfillmentOrderItemBarcode(request.id),
          label: `FOI-${request.id}`,
        };
      case 'fo':
        return {
          barcode: this.barcodeService.generateFulfillmentOrderBarcode(request.id),
          label: `FO-${request.id}`,
        };
      default:
        throw new BadRequestException(`Unknown barcode type: ${request.type}`);
    }
  }
}
