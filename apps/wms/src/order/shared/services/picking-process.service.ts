import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, inArray, sum, sql } from 'drizzle-orm';
import { BarcodeService, FOIScanResult, SkuScanResult } from '../../../shared/services/barcode.service';

export interface PickingOperation {
  batchId: string;
  skuId: string;
  locationCode?: string;
  totalQty: number;
  pickedQty: number;
  remainingQty: number;
  foiDetails: Array<{
    foiId: string;
    fulfillmentOrderId: string;
    salesOrderId: string;
    salesOrderLineId: string;
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
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly barcodeService: BarcodeService
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getPickingOperations(batchId: string): Promise<PickingOperation[]> {
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

    const skuOperations = new Map<string, PickingOperation>();

    for (const fo of batch.fulfillmentOrders) {
      for (const item of fo.items) {
        const skuId = item.skuId;

        if (!skuOperations.has(skuId)) {
          skuOperations.set(skuId, {
            batchId,
            skuId,
            locationCode: undefined, // TODO: Get from location service
            totalQty: 0,
            pickedQty: 0,
            remainingQty: 0,
            foiDetails: []
          });
        }

        const operation = skuOperations.get(skuId)!;
        operation.totalQty += item.qty;
        operation.pickedQty += item.pickedQty;
        operation.remainingQty = operation.totalQty - operation.pickedQty;

        operation.foiDetails.push({
          foiId: item.id,
          fulfillmentOrderId: fo.id,
          salesOrderId: item.salesOrderId,
          salesOrderLineId: item.salesOrderLineId,
          requiredQty: item.qty,
          pickedQty: item.pickedQty,
          remainingQty: item.qty - item.pickedQty
        });
      }
    }

    return Array.from(skuOperations.values())
      .sort((a, b) => (a.locationCode || '').localeCompare(b.locationCode || ''));
  }

  async pickItem(request: PickItemRequest): Promise<void> {
    const { batchId, skuId, pickedQty, locationCode, pickerUserId } = request;

    if (pickedQty <= 0) {
      throw new BadRequestException('Picked quantity must be positive');
    }

    const batch = await this.db.query.outboundBatches.findFirst({
      where: eq(wmsTables.outboundBatches.id, batchId)
    });

    if (!batch) {
      throw new NotFoundException(`Outbound batch ${batchId} not found`);
    }

    if (batch.status !== 'picking') {
      throw new ConflictException(`Cannot pick items from batch in status: ${batch.status}`);
    }

    const fulfillmentOrderItems = await this.db.query.fulfillmentOrderItems.findMany({
      where: and(
        eq(wmsTables.fulfillmentOrderItems.skuId, skuId),
        inArray(
          wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
          this.db.select({ id: wmsTables.fulfillmentOrders.id })
            .from(wmsTables.fulfillmentOrders)
            .where(eq(wmsTables.fulfillmentOrders.batchId, batchId))
        )
      ),
      orderBy: wmsTables.fulfillmentOrderItems.createdAt
    });

    if (fulfillmentOrderItems.length === 0) {
      throw new NotFoundException(`No items found for SKU ${skuId} in batch ${batchId}`);
    }

    const totalRequired = fulfillmentOrderItems.reduce((sum, item) => sum + item.qty, 0);
    const totalPicked = fulfillmentOrderItems.reduce((sum, item) => sum + item.pickedQty, 0);
    const totalRemaining = totalRequired - totalPicked;

    if (pickedQty > totalRemaining) {
      throw new BadRequestException(
        `Picked quantity ${pickedQty} exceeds remaining quantity ${totalRemaining} for SKU ${skuId}`
      );
    }

    await this.db.transaction(async (tx) => {
      let remainingToDistribute = pickedQty;

      for (const item of fulfillmentOrderItems) {
        if (remainingToDistribute <= 0) break;

        const itemRemaining = item.qty - item.pickedQty;
        if (itemRemaining <= 0) continue;

        const toPickForItem = Math.min(remainingToDistribute, itemRemaining);

        await tx.update(wmsTables.fulfillmentOrderItems)
          .set({
            pickedQty: item.pickedQty + toPickForItem,
            updatedAt: new Date()
          })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));

        remainingToDistribute -= toPickForItem;

        this.logger.debug(
          `Updated FOI ${item.id}: picked ${toPickForItem}, total picked: ${item.pickedQty + toPickForItem}/${item.qty}`
        );
      }

      this.logger.log(
        `Picked ${pickedQty} units of SKU ${skuId} for batch ${batchId}` +
        (pickerUserId ? ` by user ${pickerUserId}` : '') +
        (locationCode ? ` from location ${locationCode}` : '')
      );
    });
  }

  async getPickingProgress(batchId: string): Promise<PickingProgress> {
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

    const allItems = batch.fulfillmentOrders.flatMap(fo => fo.items);
    const skuGroups = new Map<string, { total: number; picked: number }>();

    for (const item of allItems) {
      if (!skuGroups.has(item.skuId)) {
        skuGroups.set(item.skuId, { total: 0, picked: 0 });
      }
      const group = skuGroups.get(item.skuId)!;
      group.total += item.qty;
      group.picked += item.pickedQty;
    }

    const completedSkus = Array.from(skuGroups.values()).filter(group => group.picked >= group.total).length;
    const totalItems = allItems.reduce((sum, item) => sum + item.qty, 0);
    const pickedItems = allItems.reduce((sum, item) => sum + item.pickedQty, 0);

    return {
      batchId,
      totalSkus: skuGroups.size,
      completedSkus,
      totalItems,
      pickedItems,
      remainingItems: totalItems - pickedItems,
      completionPercentage: totalItems > 0 ? Math.round((pickedItems / totalItems) * 100) : 0
    };
  }

  async startIndividualPicking(fulfillmentOrderId: string): Promise<IndividualPickingSession> {
    const fulfillmentOrder = await this.db.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
      with: {
        items: {
          with: {
            sku: true
          }
        }
      }
    });

    if (!fulfillmentOrder) {
      throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    if (fulfillmentOrder.status !== 'allocated' && fulfillmentOrder.status !== 'picking') {
      throw new ConflictException(`Cannot start individual picking for FO in status: ${fulfillmentOrder.status}`);
    }

    if (fulfillmentOrder.status === 'allocated') {
      await this.db.update(wmsTables.fulfillmentOrders)
        .set({ status: 'picking' })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
    }

    const completedItems = fulfillmentOrder.items.filter(item => item.pickedQty >= item.qty).length;

    return {
      fulfillmentOrderId,
      items: fulfillmentOrder.items.map(item => ({
        foiId: item.id,
        skuId: item.skuId,
        skuName: item.sku.name,
        requiredQty: item.qty,
        pickedQty: item.pickedQty,
        locationCode: undefined, // TODO: Get from location service
        isCompleted: item.pickedQty >= item.qty
      })),
      totalItems: fulfillmentOrder.items.length,
      completedItems,
      completionPercentage: fulfillmentOrder.items.length > 0
        ? Math.round((completedItems / fulfillmentOrder.items.length) * 100)
        : 0
    };
  }

  async pickIndividualItem(foiId: string, pickedQty: number): Promise<void> {
    if (pickedQty <= 0) {
      throw new BadRequestException('Picked quantity must be positive');
    }

    const item = await this.db.query.fulfillmentOrderItems.findFirst({
      where: eq(wmsTables.fulfillmentOrderItems.id, foiId),
      with: {
        fulfillmentOrder: true
      }
    });

    if (!item) {
      throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
    }

    if (item.fulfillmentOrder.status !== 'picking') {
      throw new ConflictException(`Cannot pick from FO in status: ${item.fulfillmentOrder.status}`);
    }

    const newPickedQty = item.pickedQty + pickedQty;
    if (newPickedQty > item.qty) {
      throw new BadRequestException(
        `Picked quantity ${newPickedQty} exceeds required quantity ${item.qty} for item ${foiId}`
      );
    }

    await this.db.update(wmsTables.fulfillmentOrderItems)
      .set({
        pickedQty: newPickedQty,
        updatedAt: new Date()
      })
      .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

    this.logger.log(`Individual pick: FOI ${foiId} picked ${pickedQty}, total: ${newPickedQty}/${item.qty}`);
  }

  async completeIndividualPicking(fulfillmentOrderId: string): Promise<void> {
    const fulfillmentOrder = await this.db.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
      with: {
        items: true
      }
    });

    if (!fulfillmentOrder) {
      throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    const incompleteItems = fulfillmentOrder.items.filter(item => item.pickedQty < item.qty);
    if (incompleteItems.length > 0) {
      throw new ConflictException(
        `Cannot complete picking with ${incompleteItems.length} incomplete items`
      );
    }

    await this.db.update(wmsTables.fulfillmentOrders)
      .set({
        status: 'picked',
        pickedAt: new Date()
      })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

    this.logger.log(`Completed individual picking for FO ${fulfillmentOrderId}`);
  }

  async resetPickingForItem(foiId: string): Promise<void> {
    const item = await this.db.query.fulfillmentOrderItems.findFirst({
      where: eq(wmsTables.fulfillmentOrderItems.id, foiId),
      with: {
        fulfillmentOrder: true
      }
    });

    if (!item) {
      throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
    }

    if (item.fulfillmentOrder.status !== 'picking') {
      throw new ConflictException(`Cannot reset picking for FO in status: ${item.fulfillmentOrder.status}`);
    }

    await this.db.update(wmsTables.fulfillmentOrderItems)
      .set({
        pickedQty: 0,
        updatedAt: new Date()
      })
      .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

    this.logger.log(`Reset picking for FOI ${foiId}`);
  }

  // 바코드 스캔 통합 메서드들

  async scanBarcode(barcode: string, context: {
    batchId?: string;
    fulfillmentOrderId?: string;
    warehouseId: string;
    pickerUserId?: string;
  }): Promise<{
    type: string;
    data: any;
    actions: string[];
  }> {
    const parsed = this.barcodeService.parseBarcode(barcode);

    switch (parsed.type) {
      case 'sku':
        const skuResult = await this.barcodeService.scanSku(barcode, context.warehouseId);
        return this.handleSkuScan(skuResult, context);

      case 'fulfillment_order_item':
        const foiResult = await this.barcodeService.scanFulfillmentOrderItem(barcode);
        return this.handleFOIScan(foiResult, context);

      case 'fulfillment_order':
        const foResult = await this.barcodeService.scanFulfillmentOrder(barcode);
        return this.handleFOScan(foResult, context);

      case 'location':
        return this.handleLocationScan(parsed.id, context);

      default:
        throw new BadRequestException(`Unknown barcode type: ${parsed.type}`);
    }
  }

  private async handleSkuScan(skuResult: SkuScanResult, context: any): Promise<{
    type: string;
    data: any;
    actions: string[];
  }> {
    const { skuId, skuName, availableQty } = skuResult;
    const { batchId, warehouseId } = context;

    if (!batchId) {
      return {
        type: 'sku_info',
        data: skuResult,
        actions: ['view_stock', 'search_in_batches']
      };
    }

    // 배치에서 해당 SKU 피킹 작업 찾기
    const operations = await this.getPickingOperations(batchId);
    const skuOperation = operations.find(op => op.skuId === skuId);

    if (!skuOperation) {
      return {
        type: 'sku_not_in_batch',
        data: { ...skuResult, batchId },
        actions: ['view_stock']
      };
    }

    return {
      type: 'sku_pick_ready',
      data: {
        ...skuResult,
        batchId,
        operation: skuOperation
      },
      actions: ['pick_quantity', 'view_foi_details']
    };
  }

  private async handleFOIScan(foiResult: FOIScanResult, context: any): Promise<{
    type: string;
    data: any;
    actions: string[];
  }> {
    const { foiId, fulfillmentOrderId, remainingQty, batchId } = foiResult;

    if (remainingQty <= 0) {
      return {
        type: 'foi_completed',
        data: foiResult,
        actions: ['view_details']
      };
    }

    const actions = ['pick_quantity', 'view_details'];

    if (context.fulfillmentOrderId && context.fulfillmentOrderId !== fulfillmentOrderId) {
      return {
        type: 'foi_wrong_order',
        data: foiResult,
        actions: ['view_details']
      };
    }

    if (context.batchId && batchId !== context.batchId) {
      return {
        type: 'foi_wrong_batch',
        data: foiResult,
        actions: ['view_details']
      };
    }

    return {
      type: 'foi_pick_ready',
      data: foiResult,
      actions
    };
  }

  private async handleFOScan(foResult: any, context: any): Promise<{
    type: string;
    data: any;
    actions: string[];
  }> {
    const { fulfillmentOrderId, status, totalItems, completedItems } = foResult;

    if (status === 'picked') {
      return {
        type: 'fo_completed',
        data: foResult,
        actions: ['view_details', 'start_packing']
      };
    }

    if (status !== 'picking' && status !== 'allocated') {
      return {
        type: 'fo_not_ready',
        data: foResult,
        actions: ['view_details']
      };
    }

    return {
      type: 'fo_pick_ready',
      data: foResult,
      actions: ['start_individual_picking', 'view_items']
    };
  }

  private async handleLocationScan(locationCode: string, context: any): Promise<{
    type: string;
    data: any;
    actions: string[];
  }> {
    const isValid = await this.barcodeService.validateLocationAccess(locationCode, context.warehouseId);

    if (!isValid) {
      return {
        type: 'location_access_denied',
        data: { locationCode },
        actions: []
      };
    }

    return {
      type: 'location_accessed',
      data: { locationCode },
      actions: ['view_location_stock', 'scan_next_item']
    };
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
    }
  ): Promise<{
    success: boolean;
    message: string;
    data?: any;
  }> {
    const parsed = this.barcodeService.parseBarcode(barcode);

    if (parsed.type === 'sku' && context.batchId) {
      // 토탈피킹: SKU 바코드로 배치 피킹
      await this.pickItem({
        batchId: context.batchId,
        skuId: parsed.id,
        pickedQty,
        locationCode: context.locationCode,
        pickerUserId: context.pickerUserId
      });

      return {
        success: true,
        message: `Picked ${pickedQty} units of SKU in batch`,
        data: { skuId: parsed.id, pickedQty }
      };

    } else if (parsed.type === 'fulfillment_order_item') {
      // 개별피킹: FOI 바코드로 직접 피킹
      await this.pickIndividualItem(parsed.id, pickedQty);

      return {
        success: true,
        message: `Picked ${pickedQty} units for specific order item`,
        data: { foiId: parsed.id, pickedQty }
      };

    } else {
      throw new BadRequestException(`Invalid barcode for picking: ${barcode}`);
    }
  }

  async getBarcodeForPicking(request: {
    type: 'sku' | 'foi' | 'fo';
    id: string;
  }): Promise<{ barcode: string; label?: string }> {
    switch (request.type) {
      case 'sku':
        return {
          barcode: this.barcodeService.generateSkuBarcode(request.id),
          label: `SKU-${request.id}`
        };

      case 'foi':
        return {
          barcode: this.barcodeService.generateFulfillmentOrderItemBarcode(request.id),
          label: `FOI-${request.id}`
        };

      case 'fo':
        return {
          barcode: this.barcodeService.generateFulfillmentOrderBarcode(request.id),
          label: `FO-${request.id}`
        };

      default:
        throw new BadRequestException(`Unknown barcode type: ${request.type}`);
    }
  }
}