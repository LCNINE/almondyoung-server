import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, like, lte, or, SQL, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { SkuResponseDto } from '../dto/sku-response.dto';
import { AdvancedInventoryFiltersDto, StockDisplayMode } from '../dto/advanced-filters.dto';

@Injectable()
export class SkuCatalogReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async findById(skuId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [row] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, skuId)).limit(1);
      return row;
    }, tx);
  }

  async getById(skuId: string, tx?: DbTx, warehouseId?: string): Promise<SkuResponseDto> {
    const result = await this.inTx(async (trx) => {
      const [r] = await trx
        .select()
        .from(wmsTables.skus)
        .leftJoin(wmsTables.skuGroups, eq(wmsTables.skus.groupId, wmsTables.skuGroups.id))
        .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, false)))
        .limit(1);

      if (!r) {
        return { sku: undefined, group: undefined };
      }

      return { sku: r.skus, group: r.sku_groups };
    }, tx);

    if (!result.sku) {
      throw new NotFoundError(`SKU with ID ${skuId} not found`);
    }

    const barcodes = await this.inTx(
      async (trx) => trx.select().from(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, skuId)),
      tx,
    );

    const suppliers = await this.inTx(
      async (trx) =>
        trx
          .select({ id: wmsTables.suppliers.id, name: wmsTables.suppliers.name })
          .from(wmsTables.skuSuppliers)
          .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
          .where(eq(wmsTables.skuSuppliers.skuId, skuId)),
      tx,
    );

    const categories = await this.inTx(
      async (trx) =>
        trx
          .select({ name: wmsTables.categories.name })
          .from(wmsTables.skuCategories)
          .innerJoin(wmsTables.categories, eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id))
          .where(eq(wmsTables.skuCategories.skuId, skuId)),
      tx,
    );

    const images = await this.inTx(
      async (trx) =>
        trx
          .select()
          .from(wmsTables.skuImages)
          .where(eq(wmsTables.skuImages.skuId, skuId))
          .orderBy(wmsTables.skuImages.sortOrder),
      tx,
    );

    let currentStock = 0;
    if (warehouseId) {
      const [stockInfo] = await this.inTx(
        async (trx) =>
          trx
            .select({ onHandQty: wmsSchema.stockSummary.onHandQty })
            .from(wmsSchema.stockSummary)
            .where(and(eq(wmsSchema.stockSummary.skuId, skuId), eq(wmsSchema.stockSummary.warehouseId, warehouseId)))
            .limit(1),
        tx,
      );
      currentStock = stockInfo?.onHandQty ?? 0;
    } else {
      const [stockInfo] = await this.inTx(
        async (trx) =>
          trx
            .select({ total: sql<number>`COALESCE(SUM(${wmsSchema.stockSummary.onHandQty}), 0)` })
            .from(wmsSchema.stockSummary)
            .where(eq(wmsSchema.stockSummary.skuId, skuId)),
        tx,
      );
      currentStock = Number(stockInfo?.total ?? 0);
    }

    const sku = {
      ...result.sku,
      expiryDateManagement: result.sku.expiryDateManagement ?? false,
      manufacturingDateManagement: result.sku.manufacturingDateManagement ?? false,
      isGeneralInventory: result.sku.isGeneralInventory ?? true,
    };

    return {
      ...sku,
      skuGroup: result.group,
      barcodes: barcodes.map((b) => ({
        id: b.id,
        barcode: b.barcode,
        isPrimary: b.isPrimary,
        packingUnit: b.packingUnit ?? undefined,
      })),
      suppliers,
      categoryNames: categories.map((c) => c.name),
      images: images.map((img) => ({
        id: img.id,
        uploadId: img.uploadId,
        url: '',
        isPrimary: img.isPrimary ?? false,
        sortOrder: img.sortOrder ?? 0,
        createdAt: img.createdAt,
      })),
      currentStock,
    };
  }

  async search(
    query: {
      id?: string;
      code?: string;
      barcode?: string;
      name?: string;
      supplierName?: string;
      inventoryManagement?: boolean;
      groupId?: string;
    },
    tx?: DbTx,
  ): Promise<SkuResponseDto[]> {
    return this.inTx(async (trx) => {
      let skuIdFilter: string[] | undefined;

      if (query.barcode) {
        const skuIdsFromBarcode = await trx
          .selectDistinct({ skuId: wmsTables.skuBarcodes.skuId })
          .from(wmsTables.skuBarcodes)
          .where(eq(wmsTables.skuBarcodes.barcode, query.barcode));
        skuIdFilter = skuIdsFromBarcode.map((row) => row.skuId);
        if (skuIdFilter.length === 0) return [];
      }

      if (query.supplierName) {
        const skuIdsFromSupplier = await trx
          .selectDistinct({ skuId: wmsTables.skuSuppliers.skuId })
          .from(wmsTables.skuSuppliers)
          .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
          .where(sql`${wmsTables.suppliers.name} ILIKE ${'%' + query.supplierName + '%'}`);

        const supplierSkuIds = skuIdsFromSupplier.map((row) => row.skuId);
        if (supplierSkuIds.length === 0) return [];

        skuIdFilter = skuIdFilter ? skuIdFilter.filter((id) => supplierSkuIds.includes(id)) : supplierSkuIds;

        if (skuIdFilter.length === 0) return [];
      }

      const conditions: SQL[] = [];
      conditions.push(eq(wmsTables.skus.isDeleted, false));

      if (query.id) conditions.push(eq(wmsTables.skus.id, query.id));
      if (query.code) conditions.push(eq(wmsTables.skus.code, query.code));
      if (query.groupId) conditions.push(eq(wmsTables.skus.groupId, query.groupId));
      if (query.name) conditions.push(sql`${wmsTables.skus.name} ILIKE ${'%' + query.name + '%'}`);
      if (skuIdFilter && skuIdFilter.length > 0) {
        conditions.push(inArray(wmsTables.skus.id, skuIdFilter));
      }

      const skus = await trx
        .select()
        .from(wmsTables.skus)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      if (skus.length === 0) return [];

      const skuIds = skus.map((sku) => sku.id);
      const uniqueGroupIds = [...new Set(skus.map((sku) => sku.groupId).filter((id): id is string => id !== null))];

      const groups =
        uniqueGroupIds.length > 0
          ? await trx.select().from(wmsTables.skuGroups).where(inArray(wmsTables.skuGroups.id, uniqueGroupIds))
          : [];

      const groupMap = new Map(groups.map((g) => [g.id, g]));

      const barcodes = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(inArray(wmsTables.skuBarcodes.skuId, skuIds));

      const barcodesBySkuId = new Map<string, typeof barcodes>();
      for (const barcode of barcodes) {
        if (!barcodesBySkuId.has(barcode.skuId)) {
          barcodesBySkuId.set(barcode.skuId, []);
        }
        barcodesBySkuId.get(barcode.skuId)!.push(barcode);
      }

      const skuSuppliersWithSupplier = await trx
        .select({
          skuSupplierId: wmsTables.skuSuppliers.supplierId,
          skuId: wmsTables.skuSuppliers.skuId,
          supplierId: wmsTables.suppliers.id,
          supplierName: wmsTables.suppliers.name,
        })
        .from(wmsTables.skuSuppliers)
        .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
        .where(inArray(wmsTables.skuSuppliers.skuId, skuIds));

      const suppliersBySkuId = new Map<string, Array<{ id: string; name: string }>>();
      for (const ss of skuSuppliersWithSupplier) {
        if (!suppliersBySkuId.has(ss.skuId)) suppliersBySkuId.set(ss.skuId, []);
        suppliersBySkuId.get(ss.skuId)!.push({ id: ss.supplierId, name: ss.supplierName });
      }

      const skuCategoriesWithCategory = await trx
        .select({
          skuCategoryId: wmsTables.skuCategories.categoryId,
          skuId: wmsTables.skuCategories.skuId,
          categoryId: wmsTables.categories.id,
          categoryName: wmsTables.categories.name,
        })
        .from(wmsTables.skuCategories)
        .innerJoin(wmsTables.categories, eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id))
        .where(inArray(wmsTables.skuCategories.skuId, skuIds));

      const categoriesBySkuId = new Map<string, string[]>();
      for (const sc of skuCategoriesWithCategory) {
        if (!categoriesBySkuId.has(sc.skuId)) categoriesBySkuId.set(sc.skuId, []);
        categoriesBySkuId.get(sc.skuId)!.push(sc.categoryName);
      }

      return skus.map((sku) => ({
        ...sku,
        skuGroup: sku.groupId ? (groupMap.get(sku.groupId) ?? undefined) : undefined,
        barcodes: (barcodesBySkuId.get(sku.id) || []).map((bc) => ({
          id: bc.id,
          barcode: bc.barcode,
          isPrimary: bc.isPrimary,
          packingUnit: bc.packingUnit,
        })),
        suppliers: suppliersBySkuId.get(sku.id) || [],
        categoryNames: categoriesBySkuId.get(sku.id) || [],
      }));
    }, tx);
  }

  async searchAdvanced(
    filters: AdvancedInventoryFiltersDto,
    tx?: DbTx,
  ): Promise<{ items: SkuResponseDto[]; total: number; limit: number; offset: number }> {
    return this.inTx(async (trx) => {
      if (filters.displayMode && !filters.warehouseId) {
        throw new Error('displayMode filter requires warehouseId to be specified');
      }

      const conditions: SQL[] = [];

      conditions.push(eq(wmsTables.skus.isDeleted, false));

      if (filters.search) {
        conditions.push(
          or(like(wmsTables.skus.name, `%${filters.search}%`), like(wmsTables.skus.code, `%${filters.search}%`))!,
        );
      }

      if (filters.groupId) conditions.push(eq(wmsTables.skus.groupId, filters.groupId));
      if (filters.supplierId) {
        conditions.push(
          inArray(
            wmsTables.skus.id,
            trx
              .selectDistinct({ skuId: wmsTables.skuSuppliers.skuId })
              .from(wmsTables.skuSuppliers)
              .where(eq(wmsTables.skuSuppliers.supplierId, filters.supplierId)),
          ),
        );
      }

      const stockSummaryJoinCondition = filters.warehouseId
        ? and(
            eq(wmsTables.skus.id, wmsSchema.stockSummary.skuId),
            eq(wmsSchema.stockSummary.warehouseId, filters.warehouseId),
          )
        : eq(wmsTables.skus.id, wmsSchema.stockSummary.skuId);

      const skuIdQuery = trx
        .selectDistinct({ skuId: wmsTables.skus.id })
        .from(wmsTables.skus)
        .leftJoin(wmsSchema.stockSummary, stockSummaryJoinCondition)
        .groupBy(wmsTables.skus.id);

      if (filters.displayMode && filters.warehouseId) {
        switch (filters.displayMode) {
          case StockDisplayMode.BELOW_SAFETY:
            conditions.push(sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) < ${wmsTables.skus.safetyStock}`);
            break;
          case StockDisplayMode.WITH_STOCK:
            conditions.push(sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) > 0`);
            break;
          case StockDisplayMode.OUT_OF_STOCK:
            conditions.push(sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) = 0`);
            break;
        }
      }

      const sortField = filters.sortBy ?? 'createdAt';
      const sortDirection = filters.sortOrder ?? 'desc';
      const orderCondition = sortDirection === 'asc' ? asc(wmsTables.skus[sortField]) : desc(wmsTables.skus[sortField]);

      const skuIdResults = await skuIdQuery
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderCondition)
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0);

      const uniqueSkuIds = skuIdResults.map((row) => row.skuId);

      const [countResult] = await trx
        .select({ count: sql<number>`count(DISTINCT ${wmsTables.skus.id})` })
        .from(wmsTables.skus)
        .leftJoin(wmsSchema.stockSummary, stockSummaryJoinCondition)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const total = Number(countResult?.count ?? 0);

      const items = await Promise.all(uniqueSkuIds.map((skuId) => this.getById(skuId, trx, filters.warehouseId)));

      return {
        items,
        total,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      };
    }, tx);
  }

  async getDeleted(
    filters: {
      search?: string;
      deletedStartDate?: string;
      deletedEndDate?: string;
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ): Promise<{ items: SkuResponseDto[]; total: number; limit: number; offset: number }> {
    return this.inTx(async (trx) => {
      const { skus, skuGroups } = wmsTables;
      const conditions: SQL[] = [];
      conditions.push(eq(skus.isDeleted, true));

      if (filters.search) conditions.push(like(skus.name, `%${filters.search}%`));
      if (filters.deletedStartDate) conditions.push(gte(skus.deletedAt, new Date(filters.deletedStartDate)));
      if (filters.deletedEndDate) conditions.push(lte(skus.deletedAt, new Date(filters.deletedEndDate)));

      const deleted = await trx
        .select()
        .from(skus)
        .leftJoin(skuGroups, eq(skus.groupId, skuGroups.id))
        .where(and(...conditions))
        .orderBy(desc(skus.deletedAt))
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0);

      const [countResult] = await trx
        .select({ count: sql<number>`count(*)` })
        .from(skus)
        .where(and(...conditions));

      const total = Number(countResult?.count ?? 0);

      const items = await Promise.all(
        deleted.map(async (row) => {
          const skuId = row.skus.id;

          const barcodes = await trx.select().from(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, skuId));

          const suppliers = await trx
            .select({ id: wmsTables.suppliers.id, name: wmsTables.suppliers.name })
            .from(wmsTables.skuSuppliers)
            .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
            .where(eq(wmsTables.skuSuppliers.skuId, skuId));

          const categories = await trx
            .select({ name: wmsTables.categories.name })
            .from(wmsTables.skuCategories)
            .innerJoin(wmsTables.categories, eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id))
            .where(eq(wmsTables.skuCategories.skuId, skuId));

          const images = await trx
            .select()
            .from(wmsTables.skuImages)
            .where(eq(wmsTables.skuImages.skuId, skuId))
            .orderBy(wmsTables.skuImages.sortOrder);

          const [stockInfo] = await trx
            .select({ total: sql<number>`COALESCE(SUM(${wmsSchema.stockSummary.onHandQty}), 0)` })
            .from(wmsSchema.stockSummary)
            .where(eq(wmsSchema.stockSummary.skuId, skuId));

          const currentStock = Number(stockInfo?.total ?? 0);

          return {
            ...row.skus,
            skuGroup: row.sku_groups,
            barcodes: barcodes.map((b) => ({
              id: b.id,
              barcode: b.barcode,
              isPrimary: b.isPrimary,
              packingUnit: b.packingUnit ?? undefined,
            })),
            suppliers,
            categoryNames: categories.map((c) => c.name),
            images: images.map((img) => ({
              id: img.id,
              uploadId: img.uploadId,
              url: '',
              isPrimary: img.isPrimary ?? false,
              sortOrder: img.sortOrder ?? 0,
              createdAt: img.createdAt,
            })),
            currentStock,
          };
        }),
      );

      return {
        items,
        total,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      };
    }, tx);
  }
}
