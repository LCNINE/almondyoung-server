// apps/wms/src/sku/sku.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { and, eq, like, or, sql, SQL } from 'drizzle-orm';
import { CreateSkuDto, SkuCreationSource } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];
type DbOrTx = DbTx | TypedDatabase<typeof wmsTables>;

@Injectable()
export class SkuService {
  private readonly logger = new Logger(SkuService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly db: TypedDatabase<typeof wmsTables>,
  ) { }

  private _generateSkuCode(): string {
    const prefix = 'P';
    const numericPart = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const alphaPart = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    return `${prefix}${numericPart}${alphaPart}`;
  }

  async _createSkuInternal(data: Omit<CreateSkuDto, 'id' | 'code' | 'defaultBarcode'>, tx?: DbOrTx) {
    const db = tx || this.db;
    const preStockSellable = data.inventoryManagement === true;
    const skuCode = this._generateSkuCode();

    let skuName: string;
    if (data.source === SkuCreationSource.AUTO_MATCHING) {
      skuName = `${data.productName || 'Unknown Product'} - ${data.variantName || 'Unknown Variant'}`;
    } else if (data.source === SkuCreationSource.MANUAL_MATCHING) {
      skuName = data.name;
    } else {
      skuName = data.name || `Auto-generated SKU Name (${skuCode})`;
    }

    const [newSku] = await db.insert(wmsTables.skus).values({
      name: skuName,
      code: skuCode,
      deliveryProfileId: data.deliveryProfileId,
      inventoryManagement: data.inventoryManagement,
      preStockSellable: preStockSellable,
      alwaysSellableZeroStock: data.alwaysSellableZeroStock ?? false,
      sale1m: data.sale1m,
      sale3m: data.sale3m,
    }).returning();

    if (!newSku) {
      throw new Error('Failed to create SKU internally');
    }

    const generatedBarcode = await this.generateAndSetDefaultBarcode(newSku.id, db);
    newSku.defaultBarcode = generatedBarcode;

    this.logger.log(`SKU created internally: ${newSku.id} (Name: ${newSku.name})`);
    return newSku;
  }

  private async generateAndSetDefaultBarcode(skuId: string, db: DbOrTx): Promise<string> {
    const generatedBarcode = `SKU_B_${skuId.substring(0, 8).toUpperCase()}_${Date.now()}`;

    const [newSkuBarcode] = await db.insert(wmsTables.skuBarcodes).values({
      skuId: skuId,
      barcode: generatedBarcode,
      barcodeType: 'standard',
    }).returning();

    if (!newSkuBarcode) {
      throw new Error('Failed to create default barcode for SKU.');
    }

    await db.update(wmsTables.skus)
      .set({ defaultBarcode: generatedBarcode, updatedAt: new Date() })
      .where(eq(wmsTables.skus.id, skuId));

    this.logger.log(`Default barcode ${generatedBarcode} set for SKU ${skuId}.`);
    return generatedBarcode;
  }

  async _updateSkuInternal(skuId: string, data: Partial<Omit<UpdateSkuDto, 'code' | 'defaultBarcode'>>, tx?: DbTx) {
    const db = tx || this.db;
    const updateData: Partial<typeof wmsTables.skus.$inferInsert> = {
      name: data.name,
      deliveryProfileId: data.deliveryProfileId,
      inventoryManagement: data.inventoryManagement,
      alwaysSellableZeroStock: data.alwaysSellableZeroStock,
      sale1m: data.sale1m,
      sale3m: data.sale3m,
      updatedAt: new Date(),
    };

    const [updatedSku] = await db.update(wmsTables.skus)
      .set(updateData)
      .where(eq(wmsTables.skus.id, skuId))
      .returning();

    if (!updatedSku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found for internal update`);
    }
    this.logger.log(`SKU updated internally: ${updatedSku.id}`);
    return updatedSku;
  }

  async _updatePreStockSellableInternal(skuId: string, value: boolean, tx?: DbTx) {
    const db = tx || this.db;
    const [updatedSku] = await db.update(wmsTables.skus)
      .set({
        preStockSellable: value,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.skus.id, skuId))
      .returning();

    if (!updatedSku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found to update preStockSellable.`);
    }
    this.logger.log(`SKU ${skuId} preStockSellable updated to ${value}.`);
    return updatedSku;
  }

  // 트랜잭션을 지원하도록 수정
  async findSkuById(skuId: string, tx?: DbOrTx) {
    const db = tx || this.db;
    return db.query.skus.findFirst({
      where: eq(wmsTables.skus.id, skuId)
    });
  }

  async searchSkus(query: { id?: string; code?: string; barcode?: string; name?: string; supplierName?: string }) {
    const baseQuery = this.db.select({
      sku: wmsTables.skus,
      barcode: wmsTables.skuBarcodes.barcode,
      supplierName: wmsTables.suppliers.name,
    })
      .from(wmsTables.skus)
      .leftJoin(wmsTables.skuBarcodes, eq(wmsTables.skus.id, wmsTables.skuBarcodes.skuId))
      .leftJoin(wmsTables.skuSuppliers, eq(wmsTables.skus.id, wmsTables.skuSuppliers.skuId))
      .leftJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id));

    const conditions: SQL[] = [];

    if (query.id) conditions.push(eq(wmsTables.skus.id, query.id));
    if (query.code) conditions.push(eq(wmsTables.skus.code, query.code));
    if (query.name) conditions.push(sql`${wmsTables.skus.name} ILIKE ${'%' + query.name + '%'}`);

    if (query.barcode) {
      const barcodeCondition = or(
        eq(wmsTables.skus.defaultBarcode, query.barcode),
        eq(wmsTables.skuBarcodes.barcode, query.barcode),
      );
      if (barcodeCondition) conditions.push(barcodeCondition);
    }

    if (query.supplierName) {
      conditions.push(sql`${wmsTables.suppliers.name} ILIKE ${'%' + query.supplierName + '%'}`);
    }

    const finalQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
    const results = await finalQuery;

    const aggregatedSkus = results.reduce((acc, row) => {
      const sku = row.sku;
      if (!acc[sku.id]) {
        acc[sku.id] = {
          ...sku,
          barcodes: [],
          suppliers: [],
        };
      }
      if (row.barcode && !acc[sku.id].barcodes.includes(row.barcode)) {
        acc[sku.id].barcodes.push(row.barcode);
      }
      if (row.supplierName && !acc[sku.id].suppliers.includes(row.supplierName)) {
        acc[sku.id].suppliers.push(row.supplierName);
      }
      return acc;
    }, {});

    return Object.values(aggregatedSkus);
  }
}