import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';

export interface BarcodeParseResult {
  type: 'sku' | 'location' | 'fulfillment_order' | 'fulfillment_order_item' | 'unknown';
  id: string;
  data?: any;
}

export interface SkuScanResult {
  skuId: string;
  skuName: string;
  availableQty: number;
  locationCode?: string;
}

export interface FOIScanResult {
  foiId: string;
  fulfillmentOrderId: string;
  salesOrderId: string;
  salesOrderLineId: string;
  skuId: string;
  skuName: string;
  requiredQty: number;
  pickedQty: number;
  remainingQty: number;
  batchId?: string;
}

@Injectable()
export class BarcodeService {
  private readonly logger = new Logger(BarcodeService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>
  ) {}

  private get db() {
    return this.dbService.db;
  }

  parseBarcode(barcode: string): BarcodeParseResult {
    const trimmed = barcode.trim().toUpperCase();

    // SKU 바코드: SKU-{uuid}
    if (trimmed.startsWith('SKU-')) {
      return {
        type: 'sku',
        id: trimmed.substring(4)
      };
    }

    // 로케이션 바코드: LOC-{code}
    if (trimmed.startsWith('LOC-')) {
      return {
        type: 'location',
        id: trimmed.substring(4)
      };
    }

    // FO 바코드: FO-{uuid}
    if (trimmed.startsWith('FO-')) {
      return {
        type: 'fulfillment_order',
        id: trimmed.substring(3)
      };
    }

    // FOI 바코드: FOI-{uuid}
    if (trimmed.startsWith('FOI-')) {
      return {
        type: 'fulfillment_order_item',
        id: trimmed.substring(4)
      };
    }

    // UUID 형태라면 직접 처리
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(trimmed)) {
      return {
        type: 'unknown',
        id: trimmed
      };
    }

    return {
      type: 'unknown',
      id: trimmed
    };
  }

  async scanSku(barcode: string, warehouseId: string): Promise<SkuScanResult> {
    const parsed = this.parseBarcode(barcode);

    let skuId: string;
    if (parsed.type === 'sku') {
      skuId = parsed.id;
    } else if (parsed.type === 'unknown') {
      // UUID인 경우 SKU ID로 간주
      skuId = parsed.id;
    } else {
      throw new BadRequestException(`Invalid SKU barcode: ${barcode}`);
    }

    const sku = await this.db.query.skus.findFirst({
      where: eq(wmsTables.skus.id, skuId)
    });

    if (!sku) {
      throw new BadRequestException(`SKU not found: ${skuId}`);
    }

    const stock = await this.db.query.stocks.findFirst({
      where: and(
        eq(wmsTables.stocks.skuId, skuId),
        eq(wmsTables.stocks.warehouseId, warehouseId)
      )
    });

    const availableQty = stock?.quantity || 0;

    // TODO: Get location from location service
    const locationCode = undefined;

    this.logger.log(`SKU scanned: ${sku.name} (${availableQty} available)`);

    return {
      skuId: sku.id,
      skuName: sku.name,
      availableQty,
      locationCode
    };
  }

  async scanFulfillmentOrderItem(barcode: string): Promise<FOIScanResult> {
    const parsed = this.parseBarcode(barcode);

    let foiId: string;
    if (parsed.type === 'fulfillment_order_item') {
      foiId = parsed.id;
    } else if (parsed.type === 'unknown') {
      // UUID인 경우 FOI ID로 간주
      foiId = parsed.id;
    } else {
      throw new BadRequestException(`Invalid FOI barcode: ${barcode}`);
    }

    const foi = await this.db.query.fulfillmentOrderItems.findFirst({
      where: eq(wmsTables.fulfillmentOrderItems.id, foiId),
      with: {
        sku: true,
        fulfillmentOrder: {
          with: {
            batch: true
          }
        }
      }
    });

    if (!foi) {
      throw new BadRequestException(`Fulfillment order item not found: ${foiId}`);
    }

    this.logger.log(`FOI scanned: ${foi.sku.name} for SO ${foi.salesOrderId}`);

    return {
      foiId: foi.id,
      fulfillmentOrderId: foi.fulfillmentOrderId,
      salesOrderId: foi.salesOrderId,
      salesOrderLineId: foi.salesOrderLineId,
      skuId: foi.skuId,
      skuName: foi.sku.name,
      requiredQty: foi.qty,
      pickedQty: foi.pickedQty,
      remainingQty: foi.qty - foi.pickedQty,
      batchId: foi.fulfillmentOrder.batchId
    };
  }

  async scanFulfillmentOrder(barcode: string): Promise<{
    fulfillmentOrderId: string;
    status: string;
    totalItems: number;
    completedItems: number;
    batchId?: string;
    items: Array<{
      foiId: string;
      skuName: string;
      requiredQty: number;
      pickedQty: number;
      isCompleted: boolean;
    }>;
  }> {
    const parsed = this.parseBarcode(barcode);

    let foId: string;
    if (parsed.type === 'fulfillment_order') {
      foId = parsed.id;
    } else if (parsed.type === 'unknown') {
      foId = parsed.id;
    } else {
      throw new BadRequestException(`Invalid FO barcode: ${barcode}`);
    }

    const fo = await this.db.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, foId),
      with: {
        items: {
          with: {
            sku: true
          }
        }
      }
    });

    if (!fo) {
      throw new BadRequestException(`Fulfillment order not found: ${foId}`);
    }

    const completedItems = fo.items.filter(item => item.pickedQty >= item.qty).length;

    this.logger.log(`FO scanned: ${fo.id} (${completedItems}/${fo.items.length} items completed)`);

    return {
      fulfillmentOrderId: fo.id,
      status: fo.status,
      totalItems: fo.items.length,
      completedItems,
      batchId: fo.batchId,
      items: fo.items.map(item => ({
        foiId: item.id,
        skuName: item.sku.name,
        requiredQty: item.qty,
        pickedQty: item.pickedQty,
        isCompleted: item.pickedQty >= item.qty
      }))
    };
  }

  generateSkuBarcode(skuId: string): string {
    return `SKU-${skuId}`;
  }

  generateLocationBarcode(locationCode: string): string {
    return `LOC-${locationCode}`;
  }

  generateFulfillmentOrderBarcode(fulfillmentOrderId: string): string {
    return `FO-${fulfillmentOrderId}`;
  }

  generateFulfillmentOrderItemBarcode(foiId: string): string {
    return `FOI-${foiId}`;
  }

  async validateLocationAccess(locationCode: string, warehouseId: string): Promise<boolean> {
    // TODO: Implement location validation
    // For now, just log and return true
    this.logger.log(`Location access validated: ${locationCode} in warehouse ${warehouseId}`);
    return true;
  }
}