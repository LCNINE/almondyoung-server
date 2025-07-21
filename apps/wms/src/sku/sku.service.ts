// apps/wms/src/sku/sku.service.ts
import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { and, eq, like, or, sql, SQL, isNull } from 'drizzle-orm';
import { CreateSkuDto, SkuCreationSource } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { AddBarcodeDto } from './dto/add-barcode.dto';
import { SkuResponseDto } from './dto/sku-response.dto';
import { SkuStockSummaryDto } from './dto/sku-stock-summary.dto';

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

  async _createSkuInternal(data: Omit<CreateSkuDto, 'id' | 'code' | 'defaultBarcode' | 'supplierIds' | 'categoryIds'>, tx?: DbOrTx) {
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

  async findSkuById(skuId: string, tx?: DbOrTx) {
    const db = tx || this.db;
    return db.query.skus.findFirst({
      where: eq(wmsTables.skus.id, skuId)
    });
  }

  async createSku(createSkuDto: CreateSkuDto): Promise<SkuResponseDto> {
    return this.db.transaction(async (tx) => {
      const { supplierIds, categoryIds, ...skuData } = createSkuDto;

      // SKU 생성
      const newSku = await this._createSkuInternal(skuData, tx);

      // 공급사 연결
      if (supplierIds && supplierIds.length > 0) {
        await tx.insert(wmsTables.skuSuppliers).values(
          supplierIds.map(supplierId => ({
            skuId: newSku.id,
            supplierId,
          }))
        );
      }

      // 카테고리 연결
      if (categoryIds && categoryIds.length > 0) {
        await tx.insert(wmsTables.skuCategories).values(
          categoryIds.map(categoryId => ({
            skuId: newSku.id,
            categoryId,
          }))
        );
      }

      // 전체 정보 조회 후 반환
      return this.getSkuById(newSku.id);
    });
  }

  async updateSku(skuId: string, updateSkuDto: UpdateSkuDto): Promise<SkuResponseDto> {
    return this.db.transaction(async (tx) => {
      const { supplierIds, categoryIds, ...updateData } = updateSkuDto;

      // SKU 업데이트
      await this._updateSkuInternal(skuId, updateData, tx);

      // 공급사 업데이트
      if (supplierIds !== undefined) {
        await tx.delete(wmsTables.skuSuppliers)
          .where(eq(wmsTables.skuSuppliers.skuId, skuId));

        if (supplierIds.length > 0) {
          await tx.insert(wmsTables.skuSuppliers).values(
            supplierIds.map(supplierId => ({
              skuId,
              supplierId,
            }))
          );
        }
      }

      // 카테고리 업데이트
      if (categoryIds !== undefined) {
        await tx.delete(wmsTables.skuCategories)
          .where(eq(wmsTables.skuCategories.skuId, skuId));

        if (categoryIds.length > 0) {
          await tx.insert(wmsTables.skuCategories).values(
            categoryIds.map(categoryId => ({
              skuId,
              categoryId,
            }))
          );
        }
      }

      return this.getSkuById(skuId);
    });
  }

  async deleteSku(skuId: string): Promise<void> {
    // 재고가 있는지 확인
    const activeStock = await this.db.query.stocks.findFirst({
      where: and(
        eq(wmsTables.stocks.skuId, skuId),
        isNull(wmsTables.stocks.destroyerEventId)
      ),
    });

    if (activeStock && activeStock.realQuantity > 0) {
      throw new ConflictException(`Cannot delete SKU ${skuId}: Active stock exists`);
    }

    // Product matching 확인
    const matchings = await this.db.query.productVariantSkuLinks.findMany({
      where: eq(wmsTables.productVariantSkuLinks.skuId, skuId),
    });

    if (matchings.length > 0) {
      throw new ConflictException(`Cannot delete SKU ${skuId}: Used in product matchings`);
    }

    await this.db.delete(wmsTables.skus)
      .where(eq(wmsTables.skus.id, skuId));

    this.logger.log(`SKU ${skuId} deleted successfully`);
  }

  async getSkuById(skuId: string): Promise<SkuResponseDto> {
    // 메인 SKU 조회
    const sku = await this.db.query.skus.findFirst({
      where: eq(wmsTables.skus.id, skuId),
    });

    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    // 바코드 조회
    const barcodes = await this.db.query.skuBarcodes.findMany({
      where: eq(wmsTables.skuBarcodes.skuId, skuId),
    });

    // 공급사 조회
    const suppliers = await this.db
      .select({
        name: wmsTables.suppliers.name,
      })
      .from(wmsTables.skuSuppliers)
      .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
      .where(eq(wmsTables.skuSuppliers.skuId, skuId));

    // 카테고리 조회
    const categories = await this.db
      .select({
        name: wmsTables.categories.name,
      })
      .from(wmsTables.skuCategories)
      .innerJoin(wmsTables.categories, eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id))
      .where(eq(wmsTables.skuCategories.skuId, skuId));

    return {
      id: sku.id,
      name: sku.name,
      code: sku.code,
      defaultBarcode: sku.defaultBarcode ?? undefined,
      deliveryProfileId: sku.deliveryProfileId ?? undefined,
      inventoryManagement: sku.inventoryManagement,
      preStockSellable: sku.preStockSellable,
      alwaysSellableZeroStock: sku.alwaysSellableZeroStock,
      sale1m: sku.sale1m ?? undefined,
      sale3m: sku.sale3m ?? undefined,
      barcodes: barcodes.map(b => ({
        id: b.id,
        barcode: b.barcode,
        barcodeType: b.barcodeType,
        packingUnit: b.packingUnit ?? undefined,
      })),
      supplierNames: suppliers.map(s => s.name),
      categoryNames: categories.map(c => c.name),
      createdAt: sku.createdAt ?? new Date(),
      updatedAt: sku.updatedAt ?? new Date(),
    };
  }

  async searchSkus(query: {
    id?: string;
    code?: string;
    barcode?: string;
    name?: string;
    supplierName?: string;
    inventoryManagement?: boolean;
  }): Promise<SkuResponseDto[]> {
    const baseQuery = this.db.select({
      sku: wmsTables.skus,
      barcode: wmsTables.skuBarcodes,
      supplier: wmsTables.suppliers,
      category: wmsTables.categories,
    })
      .from(wmsTables.skus)
      .leftJoin(wmsTables.skuBarcodes, eq(wmsTables.skus.id, wmsTables.skuBarcodes.skuId))
      .leftJoin(wmsTables.skuSuppliers, eq(wmsTables.skus.id, wmsTables.skuSuppliers.skuId))
      .leftJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
      .leftJoin(wmsTables.skuCategories, eq(wmsTables.skus.id, wmsTables.skuCategories.skuId))
      .leftJoin(wmsTables.categories, eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id));

    const conditions: SQL[] = [];

    if (query.id) conditions.push(eq(wmsTables.skus.id, query.id));
    if (query.code) conditions.push(eq(wmsTables.skus.code, query.code));
    if (query.name) conditions.push(sql`${wmsTables.skus.name} ILIKE ${'%' + query.name + '%'}`);
    if (query.inventoryManagement !== undefined) {
      conditions.push(eq(wmsTables.skus.inventoryManagement, query.inventoryManagement));
    }

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

    // 결과 집계
    const aggregatedSkus = results.reduce((acc, row) => {
      const sku = row.sku;
      if (!acc[sku.id]) {
        acc[sku.id] = {
          ...sku,
          barcodes: new Map(),
          supplierNames: new Set<string>(),
          categoryNames: new Set<string>(),
        };
      }

      if (row.barcode) {
        acc[sku.id].barcodes.set(row.barcode.id, {
          id: row.barcode.id,
          barcode: row.barcode.barcode,
          barcodeType: row.barcode.barcodeType,
          packingUnit: row.barcode.packingUnit,
        });
      }

      if (row.supplier) {
        acc[sku.id].supplierNames.add(row.supplier.name);
      }

      if (row.category) {
        acc[sku.id].categoryNames.add(row.category.name);
      }

      return acc;
    }, {} as Record<string, any>);

    // SkuResponseDto 형식으로 변환
    return Object.values(aggregatedSkus).map(sku => ({
      id: sku.id,
      name: sku.name,
      code: sku.code,
      defaultBarcode: sku.defaultBarcode,
      deliveryProfileId: sku.deliveryProfileId,
      inventoryManagement: sku.inventoryManagement,
      preStockSellable: sku.preStockSellable,
      alwaysSellableZeroStock: sku.alwaysSellableZeroStock,
      sale1m: sku.sale1m,
      sale3m: sku.sale3m,
      barcodes: Array.from(sku.barcodes.values()),
      supplierNames: Array.from(sku.supplierNames),
      categoryNames: Array.from(sku.categoryNames),
      createdAt: sku.createdAt,
      updatedAt: sku.updatedAt,
    }));
  }

  async addBarcode(skuId: string, addBarcodeDto: AddBarcodeDto): Promise<void> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    // 바코드 중복 확인
    const existingBarcode = await this.db.query.skuBarcodes.findFirst({
      where: eq(wmsTables.skuBarcodes.barcode, addBarcodeDto.barcode),
    });

    if (existingBarcode) {
      throw new ConflictException(`Barcode ${addBarcodeDto.barcode} already exists`);
    }

    await this.db.insert(wmsTables.skuBarcodes).values({
      skuId,
      barcode: addBarcodeDto.barcode,
      barcodeType: addBarcodeDto.barcodeType || 'standard',
      packingUnit: addBarcodeDto.packingUnit,
    });

    this.logger.log(`Barcode ${addBarcodeDto.barcode} added to SKU ${skuId}`);
  }

  async removeBarcode(skuId: string, barcodeId: string): Promise<void> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    // 기본 바코드인지 확인
    const barcode = await this.db.query.skuBarcodes.findFirst({
      where: and(
        eq(wmsTables.skuBarcodes.id, barcodeId),
        eq(wmsTables.skuBarcodes.skuId, skuId)
      ),
    });

    if (!barcode) {
      throw new NotFoundException(`Barcode with ID ${barcodeId} not found for SKU ${skuId}`);
    }

    if (sku.defaultBarcode === barcode.barcode) {
      throw new BadRequestException('Cannot remove default barcode');
    }

    await this.db.delete(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.id, barcodeId));

    this.logger.log(`Barcode ${barcodeId} removed from SKU ${skuId}`);
  }

  async getSkuStockSummary(skuId: string): Promise<SkuStockSummaryDto> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    // 모든 활성 재고 조회
    const stocks = await this.db.query.stocks.findMany({
      where: and(
        eq(wmsTables.stocks.skuId, skuId),
        isNull(wmsTables.stocks.destroyerEventId)
      ),
    });

    // 창고 정보 조회
    const warehouseIds = [...new Set(stocks.map(s => s.warehouseId))];
    const warehouses = await this.db.query.warehouses.findMany({
      where: sql`${wmsTables.warehouses.id} IN (${sql.join(warehouseIds.map(id => sql`${id}`), sql`, `)})`
    });
    const warehouseMap = new Map(warehouses.map(w => [w.id, w]));

    // 창고별 집계
    const warehouseStocks = stocks.reduce((acc, stock) => {
      const warehouseId = stock.warehouseId;
      const warehouse = warehouseMap.get(warehouseId);

      if (!acc[warehouseId]) {
        acc[warehouseId] = {
          warehouseId,
          warehouseName: warehouse?.name || 'Unknown Warehouse',
          realQuantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
        };
      }
      acc[warehouseId].realQuantity += stock.realQuantity;
      acc[warehouseId].reservedQuantity += stock.reservedQuantity;
      acc[warehouseId].availableQuantity += stock.availableQuantity;
      return acc;
    }, {} as Record<string, any>);

    // 전체 합계
    const totals = stocks.reduce(
      (acc, stock) => ({
        totalRealQuantity: acc.totalRealQuantity + stock.realQuantity,
        totalReservedQuantity: acc.totalReservedQuantity + stock.reservedQuantity,
        totalAvailableQuantity: acc.totalAvailableQuantity + stock.availableQuantity,
      }),
      { totalRealQuantity: 0, totalReservedQuantity: 0, totalAvailableQuantity: 0 }
    );

    return {
      skuId: sku.id,
      skuName: sku.name,
      skuCode: sku.code,
      totalRealQuantity: totals.totalRealQuantity,
      totalReservedQuantity: totals.totalReservedQuantity,
      totalAvailableQuantity: totals.totalAvailableQuantity,
      warehouseStocks: Object.values(warehouseStocks),
    };
  }

  async updateAlwaysSellableZeroStock(skuId: string, value: boolean): Promise<void> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    // 재고 관리 대상이 아닌 SKU는 항상 판매 가능 설정 불가
    if (!sku.inventoryManagement) {
      throw new BadRequestException('Cannot set alwaysSellableZeroStock for non-inventory managed SKU');
    }

    // true로 설정 시 현재 재고 확인
    if (value) {
      const stockSummary = await this.getSkuStockSummary(skuId);
      if (stockSummary.totalRealQuantity > 0) {
        throw new BadRequestException(
          'Cannot enable alwaysSellableZeroStock when stock exists. ' +
          'This feature is only for drop-ship or pre-launch products with no physical stock.'
        );
      }
    }

    await this.db.update(wmsTables.skus)
      .set({
        alwaysSellableZeroStock: value,
        // alwaysSellableZeroStock가 true면 preStockSellable도 false로 설정
        preStockSellable: value ? false : sku.preStockSellable,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.skus.id, skuId));

    this.logger.log(`SKU ${skuId} alwaysSellableZeroStock updated to ${value}`);
  }

  async batchUpdateAlwaysSellableZeroStock(
    updates: Array<{ skuId: string; value: boolean }>
  ): Promise<{ success: string[]; failed: Array<{ skuId: string; reason: string }> }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ skuId: string; reason: string }>,
    };

    for (const update of updates) {
      try {
        await this.updateAlwaysSellableZeroStock(update.skuId, update.value);
        results.success.push(update.skuId);
      } catch (error) {
        results.failed.push({
          skuId: update.skuId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }
}