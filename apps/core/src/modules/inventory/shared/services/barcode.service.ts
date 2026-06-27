import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { and, eq } from 'drizzle-orm';
import * as bwipjs from 'bwip-js';

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
  salesOrderId: string | null;
  salesOrderLineId: string | null;
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

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  parseBarcode(barcode: string): BarcodeParseResult {
    const trimmed = barcode.trim().toUpperCase();

    // SKU 바코드: SKU-{uuid}
    if (trimmed.startsWith('SKU-')) {
      return {
        type: 'sku',
        id: trimmed.substring(4),
      };
    }

    // 로케이션 바코드: LOC-{code}
    if (trimmed.startsWith('LOC-')) {
      return {
        type: 'location',
        id: trimmed.substring(4),
      };
    }

    // FO 바코드: FO-{uuid}
    if (trimmed.startsWith('FO-')) {
      return {
        type: 'fulfillment_order',
        id: trimmed.substring(3),
      };
    }

    // FOI 바코드: FOI-{uuid}
    if (trimmed.startsWith('FOI-')) {
      return {
        type: 'fulfillment_order_item',
        id: trimmed.substring(4),
      };
    }

    // UUID 형태라면 직접 처리
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(trimmed)) {
      return {
        type: 'unknown',
        id: trimmed,
      };
    }

    return {
      type: 'unknown',
      id: trimmed,
    };
  }

  async scanSku(barcode: string, warehouseId: string, tx?: DbTx): Promise<SkuScanResult> {
    return this.dbService.run(async (trx) => {
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

      const sku = await trx.query.skus.findFirst({
        where: eq(wmsTables.skus.id, skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${skuId}`);
      }

      // stocks 테이블 대신 stockLedgers에서 ON_HAND 상태 재고 조회
      const stockLedgers = await trx.query.stockLedgers.findMany({
        where: and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      });

      const availableQty = stockLedgers.reduce((sum, ledger) => sum + ledger.qty, 0);

      // TODO: Get location from location service
      const locationCode = undefined;

      this.logger.log(`SKU scanned: ${sku.name} (${availableQty} available)`);

      return {
        skuId: sku.id,
        skuName: sku.name,
        availableQty,
        locationCode,
      };
    }, tx);
  }

  async scanFulfillmentOrderItem(barcode: string, tx?: DbTx): Promise<FOIScanResult> {
    return this.dbService.run(async (trx) => {
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

      const rows = await trx
        .select({
          foiId: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
          salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          skuName: wmsTables.skus.name,
          requiredQty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          batchId: wmsTables.fulfillmentOrders.batchId,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId))
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new BadRequestException(`Fulfillment order item not found: ${foiId}`);
      }

      this.logger.log(`FOI scanned: ${row.skuName} for SO ${row.salesOrderId}`);

      return {
        foiId: row.foiId,
        fulfillmentOrderId: row.fulfillmentOrderId,
        salesOrderId: row.salesOrderId,
        salesOrderLineId: row.salesOrderLineId,
        skuId: row.skuId,
        skuName: row.skuName,
        requiredQty: row.requiredQty,
        pickedQty: row.pickedQty,
        remainingQty: row.requiredQty - row.pickedQty,
        batchId: row.batchId ?? undefined,
      };
    }, tx);
  }

  async scanFulfillmentOrder(
    barcode: string,
    tx?: DbTx,
  ): Promise<{
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
    return this.dbService.run(async (trx) => {
      const parsed = this.parseBarcode(barcode);

      let foId: string;
      if (parsed.type === 'fulfillment_order') {
        foId = parsed.id;
      } else if (parsed.type === 'unknown') {
        foId = parsed.id;
      } else {
        throw new BadRequestException(`Invalid FO barcode: ${barcode}`);
      }

      // FO 기본 정보 조회
      const foRows = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          status: wmsTables.fulfillmentOrders.status,
          batchId: wmsTables.fulfillmentOrders.batchId,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, foId))
        .limit(1);

      const fo = foRows[0];
      if (!fo) {
        throw new BadRequestException(`Fulfillment order not found: ${foId}`);
      }

      // 아이템 + SKU 이름 조인 조회
      const itemRows = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          skuName: wmsTables.skus.name,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));

      const completedItems = itemRows.filter((r) => r.pickedQty >= r.qty).length;

      this.logger.log(`FO scanned: ${fo.id} (${completedItems}/${itemRows.length} items completed)`);

      return {
        fulfillmentOrderId: fo.id,
        status: fo.status,
        totalItems: itemRows.length,
        completedItems,
        batchId: fo.batchId ?? undefined,
        items: itemRows.map((r) => ({
          foiId: r.id,
          skuName: r.skuName,
          requiredQty: r.qty,
          pickedQty: r.pickedQty,
          isCompleted: r.pickedQty >= r.qty,
        })),
      };
    }, tx);
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

  async validateLocationAccess(locationCode: string, warehouseId: string, tx?: DbTx): Promise<boolean> {
    return this.dbService.run(async (trx) => {
      // TODO: Implement location validation
      // For now, just log and return true
      this.logger.log(`Location access validated: ${locationCode} in warehouse ${warehouseId}`);
      return true;
    }, tx);
  }

  /**
   * 바코드 이미지를 Base64 PNG로 생성
   */
  async generateBarcodeImage(
    value: string,
    format: 'CODE128' | 'QR' | 'EAN13' | 'CODE39' = 'CODE128',
    options?: {
      scale?: number;
      height?: number;
      includetext?: boolean;
      textxalign?: 'left' | 'center' | 'right' | 'offleft' | 'offright' | 'justify';
      textsize?: number;
    },
  ): Promise<string> {
    try {
      const barcodeTypeMap: Record<string, string> = {
        CODE128: 'code128',
        QR: 'qrcode',
        EAN13: 'ean13',
        CODE39: 'code39',
      };

      const barcodeType = barcodeTypeMap[format] || 'code128';

      this.logger.log(`Generating ${format} barcode for value: ${value}`);

      const png = await bwipjs.toBuffer({
        bcid: barcodeType,
        text: value,
        scale: options?.scale ?? 3,
        height: options?.height ?? 10,
        includetext: options?.includetext ?? true,
        textxalign: options?.textxalign ?? 'center',
        textsize: options?.textsize ?? 10,
      });

      return Buffer.from(png).toString('base64');
    } catch (error) {
      this.logger.error(`Failed to generate barcode: ${error.message}`);
      throw new BadRequestException(`Failed to generate barcode: ${error.message}`);
    }
  }

  /**
   * 바코드 포맷 검증
   */
  validateBarcodeFormat(value: string, format: string): boolean {
    switch (format) {
      case 'CODE128':
        return value.length >= 1 && value.length <= 128;
      case 'QR':
        return value.length >= 1 && value.length <= 2000;
      case 'EAN13':
        return /^\d{13}$/.test(value);
      case 'CODE39':
        return /^[A-Z0-9\-\.\ \$\/\+\%]+$/.test(value) && value.length >= 1 && value.length <= 80;
      default:
        return false;
    }
  }

  /**
   * SKU용 바코드 이미지 생성
   */
  async generateSkuBarcodeImage(
    skuId: string,
    format: 'CODE128' | 'QR' = 'CODE128',
  ): Promise<{
    barcodeValue: string;
    format: string;
    imageBase64: string;
  }> {
    const barcodeValue = this.generateSkuBarcode(skuId);
    const imageBase64 = await this.generateBarcodeImage(barcodeValue, format);

    return {
      barcodeValue,
      format,
      imageBase64,
    };
  }

  /**
   * Location용 바코드 이미지 생성
   */
  async generateLocationBarcodeImage(
    locationCode: string,
    format: 'CODE128' | 'QR' = 'CODE128',
  ): Promise<{
    barcodeValue: string;
    format: string;
    imageBase64: string;
  }> {
    const barcodeValue = this.generateLocationBarcode(locationCode);
    const imageBase64 = await this.generateBarcodeImage(barcodeValue, format);

    return {
      barcodeValue,
      format,
      imageBase64,
    };
  }

  /**
   * Fulfillment Order용 바코드 이미지 생성
   */
  async generateFulfillmentOrderBarcodeImage(
    fulfillmentOrderId: string,
    format: 'CODE128' | 'QR' = 'CODE128',
  ): Promise<{
    barcodeValue: string;
    format: string;
    imageBase64: string;
  }> {
    const barcodeValue = this.generateFulfillmentOrderBarcode(fulfillmentOrderId);
    const imageBase64 = await this.generateBarcodeImage(barcodeValue, format);

    return {
      barcodeValue,
      format,
      imageBase64,
    };
  }

  /**
   * 사용자 정의 바코드 이미지 생성
   */
  async generateCustomBarcodeImage(
    value: string,
    format: 'CODE128' | 'QR' | 'EAN13' | 'CODE39' = 'CODE128',
    options?: {
      scale?: number;
      height?: number;
      includetext?: boolean;
    },
  ): Promise<{
    barcodeValue: string;
    format: string;
    imageBase64: string;
  }> {
    // 포맷 검증
    if (!this.validateBarcodeFormat(value, format)) {
      throw new BadRequestException(`Invalid barcode value for format ${format}: ${value}`);
    }

    const imageBase64 = await this.generateBarcodeImage(value, format, options);

    return {
      barcodeValue: value,
      format,
      imageBase64,
    };
  }
}
