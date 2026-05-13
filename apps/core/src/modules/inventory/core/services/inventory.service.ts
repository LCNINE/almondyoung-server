import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectTypedDb, TypedDatabase, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, SkuBarcode } from '../../schema/inventory.schema';
import { and, eq, isNull, or, sql, asc, like, gte, lte, isNotNull, SQL, inArray, desc } from 'drizzle-orm';
import { AdvancedInventoryFiltersDto, StockDisplayMode } from '../dto/inventory/advanced-filters.dto';
import { CreateSkuDto, SkuCreationSource } from '../dto/sku/create-sku.dto';
import { UpdateSkuDto } from '../dto/sku/update-sku.dto';
import { AddBarcodeDto } from '../dto/sku/add-barcode.dto';
import { BarcodeDto, SkuResponseDto } from '../dto/sku/sku-response.dto';
import { HOLDER_CONSTANTS } from '../constants/holder.constants';
import { StockEventStore } from '../repositories/stock-event.store';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
    private readonly queryService: InventoryQueryService,
    private readonly commandService: InventoryCommandService,
    private readonly locationService: LocationService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async onModuleInit() {
    await this._ensureDefaultHoldersExist();
  }

  // ****************************************************************
  // SKU 관리 도메인
  // ****************************************************************

  async createSku(createSkuDto: CreateSkuDto, tx?: DbTx): Promise<SkuResponseDto> {
    return this.inTx(async (trx) => {
      const { supplierIds, categoryIds, source, skuGroupId, imageUploadIds, ...skuData } = createSkuDto;

      const [newSku] = await trx
        .insert(wmsTables.skus)
        .values({
          ...skuData,
          ...(skuGroupId && { groupId: skuGroupId }),
          code: await this._generateSkuCode(trx),
        })
        .returning();

      if (supplierIds && supplierIds.length > 0) {
        await trx.insert(wmsTables.skuSuppliers).values(
          supplierIds.map((supplierId) => ({
            skuId: newSku.id,
            supplierId,
          })),
        );
      }

      if (categoryIds && categoryIds.length > 0) {
        await trx.insert(wmsTables.skuCategories).values(
          categoryIds.map((categoryId) => ({
            skuId: newSku.id,
            categoryId,
          })),
        );
      }

      if (imageUploadIds && imageUploadIds.length > 0) {
        const imageRecords = imageUploadIds.map((uploadId, index) => ({
          skuId: newSku.id,
          uploadId,
          isPrimary: index === 0,
          sortOrder: index,
        }));

        await trx.insert(wmsTables.skuImages).values(imageRecords);
      }

      // Create primary barcode that equals SKU code
      await trx.insert(wmsTables.skuBarcodes).values({
        skuId: newSku.id,
        barcode: newSku.code,
        isPrimary: true,
      });

      return this.getSkuById(newSku.id, trx);
    }, tx);
  }

  async updateSku(skuId: string, updateSkuDto: UpdateSkuDto, tx?: DbTx): Promise<SkuResponseDto> {
    return this.inTx(async (trx) => {
      const { supplierIds, categoryIds, skuGroupId, imageUploadIds, ...updateData } = updateSkuDto;

      const skuUpdatePayload = {
        ...updateData,
        ...(skuGroupId !== undefined && { groupId: skuGroupId }),
      };

      if (Object.keys(skuUpdatePayload).length > 0) {
        await trx.update(wmsTables.skus).set(skuUpdatePayload).where(eq(wmsTables.skus.id, skuId));
      }

      if (supplierIds !== undefined) {
        await trx.delete(wmsTables.skuSuppliers).where(eq(wmsTables.skuSuppliers.skuId, skuId));

        if (supplierIds.length > 0) {
          await trx.insert(wmsTables.skuSuppliers).values(
            supplierIds.map((supplierId) => ({
              skuId,
              supplierId,
            })),
          );
        }
      }

      if (categoryIds !== undefined) {
        await trx.delete(wmsTables.skuCategories).where(eq(wmsTables.skuCategories.skuId, skuId));

        if (categoryIds.length > 0) {
          await trx.insert(wmsTables.skuCategories).values(
            categoryIds.map((categoryId) => ({
              skuId,
              categoryId,
            })),
          );
        }
      }

      if (imageUploadIds !== undefined) {
        await trx.delete(wmsTables.skuImages).where(eq(wmsTables.skuImages.skuId, skuId));

        if (imageUploadIds.length > 0) {
          const imageRecords = imageUploadIds.map((uploadId, index) => ({
            skuId,
            uploadId,
            isPrimary: index === 0,
            sortOrder: index,
          }));

          await trx.insert(wmsTables.skuImages).values(imageRecords);
        }
      }

      return this.getSkuById(skuId, trx);
    }, tx);
  }

  async deleteSku(skuId: string, tx?: DbTx): Promise<void> {
    if (!skuId || typeof skuId !== 'string') {
      throw new BadRequestException('Valid SKU ID is required');
    }

    try {
      await this.inTx(async (trx) => {
        // 1. SKU 존재 확인
        const [sku] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, skuId)).limit(1);

        if (!sku) {
          throw new NotFoundException(`SKU with ID ${skuId} not found`);
        }

        // 2. 활성 재고 확인
        const [stockAgg] = await trx
          .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}),0)` })
          .from(wmsTables.stockLedgers)
          .where(eq(wmsTables.stockLedgers.skuId, skuId));

        const totalStock = stockAgg?.qty ?? 0;
        if (totalStock > 0) {
          throw new ConflictException(
            `Cannot delete SKU ${skuId}: Has active stock of ${totalStock} units. ` +
              'Please adjust stock to zero before deletion.',
          );
        }

        // 3. 상품 매칭 사용 확인
        const matchings = await trx
          .select({ productMatchingId: wmsTables.productVariantSkuLinks.productMatchingId })
          .from(wmsTables.productVariantSkuLinks)
          .where(eq(wmsTables.productVariantSkuLinks.skuId, skuId));

        if (matchings.length > 0) {
          const matchingIds = matchings.map((m) => m.productMatchingId).join(', ');
          throw new ConflictException(
            `Cannot delete SKU ${skuId}: Used in ${matchings.length} product matching(s): ${matchingIds}. ` +
              'Please remove from product matchings first.',
          );
        }

        // 4. 예약 확인
        const reservations = await trx
          .select({ id: wmsTables.stockReservations.id })
          .from(wmsTables.stockReservations)
          .where(
            and(eq(wmsTables.stockReservations.skuId, skuId), eq(wmsTables.stockReservations.status, 'confirmed')),
          );

        if (reservations.length > 0) {
          throw new ConflictException(
            `Cannot delete SKU ${skuId}: Has ${reservations.length} active reservation(s). ` +
              'Please release all reservations first.',
          );
        }

        // 5. 삭제 실행
        const deleteResult = await trx
          .update(wmsTables.skus)
          .set({ isDeleted: true, deletedAt: new Date() })
          .where(eq(wmsTables.skus.id, skuId))
          .returning();

        if (deleteResult.length === 0) {
          throw new ConflictException(`Failed to delete SKU ${skuId}. It may have been deleted by another process.`);
        }

        this.logger.log(`SKU ${skuId} (${sku.name}) deleted successfully`);
      }, tx);
    } catch (error) {
      this.logger.error(`Failed to delete SKU ${skuId}:`, error);
      throw error;
    }
  }

  async getDeletedSkus(
    filters: {
      search?: string;
      deletedStartDate?: string;
      deletedEndDate?: string;
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ): Promise<{
    items: SkuResponseDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.inTx(async (trx) => {
      const { skus, skuGroups } = wmsTables;

      const conditions: SQL[] = [];

      conditions.push(eq(skus.isDeleted, true));

      if (filters.search) {
        conditions.push(like(skus.name, `%${filters.search}%`));
      }

      if (filters.deletedStartDate) {
        conditions.push(gte(skus.deletedAt, new Date(filters.deletedStartDate)));
      }

      if (filters.deletedEndDate) {
        conditions.push(lte(skus.deletedAt, new Date(filters.deletedEndDate)));
      }

      const deletedSkus = await trx
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
        deletedSkus.map(async (row) => {
          const skuId = row.skus.id;

          const barcodes = await trx.select().from(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, skuId));

          const suppliers = await trx
            .select({
              id: wmsTables.suppliers.id,
              name: wmsTables.suppliers.name,
            })
            .from(wmsTables.skuSuppliers)
            .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
            .where(eq(wmsTables.skuSuppliers.skuId, skuId));

          const categories = await trx
            .select({
              name: wmsTables.categories.name,
            })
            .from(wmsTables.skuCategories)
            .innerJoin(wmsTables.categories, eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id))
            .where(eq(wmsTables.skuCategories.skuId, skuId));

          const images = await trx
            .select()
            .from(wmsTables.skuImages)
            .where(eq(wmsTables.skuImages.skuId, skuId))
            .orderBy(wmsTables.skuImages.sortOrder);

          const [stockInfo] = await trx
            .select({
              total: sql<number>`COALESCE(SUM(${wmsSchema.stockSummary.onHandQty}), 0)`,
            })
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
            suppliers: suppliers,
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

  async restoreSku(skuId: string, tx?: DbTx): Promise<SkuResponseDto> {
    if (!skuId || typeof skuId !== 'string') {
      throw new BadRequestException('Valid SKU ID is required');
    }

    return this.inTx(async (trx) => {
      const [sku] = await trx
        .select()
        .from(wmsTables.skus)
        .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, true)))
        .limit(1);

      if (!sku) {
        throw new NotFoundException(`Deleted SKU with ID ${skuId} not found. It may not exist or may not be deleted.`);
      }

      const [restored] = await trx
        .update(wmsTables.skus)
        .set({
          isDeleted: false,
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.skus.id, skuId))
        .returning();

      if (!restored) {
        throw new ConflictException(`Failed to restore SKU ${skuId}`);
      }

      this.logger.log(`SKU ${skuId} (${sku.name}) restored successfully`);

      return this.getSkuById(skuId, trx);
    }, tx);
  }

  async getSkuById(skuId: string, tx?: DbTx, warehouseId?: string): Promise<SkuResponseDto> {
    const result = await this.inTx(async (trx) => {
      const [result] = await trx
        .select()
        .from(wmsTables.skus)
        .leftJoin(wmsTables.skuGroups, eq(wmsTables.skus.groupId, wmsTables.skuGroups.id))
        .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, false)))
        .limit(1);

      if (!result) {
        return { sku: undefined, group: undefined };
      }

      return { sku: result.skus, group: result.sku_groups };
    }, tx);

    if (!result.sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const barcodes = await this.inTx(
      async (trx) => trx.select().from(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, skuId)),
      tx,
    );

    const suppliers = await this.inTx(
      async (trx) =>
        trx
          .select({
            id: wmsTables.suppliers.id,
            name: wmsTables.suppliers.name,
          })
          .from(wmsTables.skuSuppliers)
          .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
          .where(eq(wmsTables.skuSuppliers.skuId, skuId)),
      tx,
    );

    const categories = await this.inTx(
      async (trx) =>
        trx
          .select({
            name: wmsTables.categories.name,
          })
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

    // 재고 정보 조회
    let currentStock = 0;
    if (warehouseId) {
      // 특정 창고의 재고만 조회
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
      // 전체 창고 합계
      const [stockInfo] = await this.inTx(
        async (trx) =>
          trx
            .select({
              total: sql<number>`COALESCE(SUM(${wmsSchema.stockSummary.onHandQty}), 0)`,
            })
            .from(wmsSchema.stockSummary)
            .where(eq(wmsSchema.stockSummary.skuId, skuId)),
        tx,
      );

      currentStock = Number(stockInfo?.total ?? 0);
    }

    // 타입 안전성과 type inference를 유지하기 위해 객체 spread와 nullish coalescing 사용
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
      suppliers: suppliers,
      categoryNames: categories.map((c) => c.name),
      images: images.map((img) => ({
        id: img.id,
        uploadId: img.uploadId,
        url: '', // TODO: Fetch from File Service
        isPrimary: img.isPrimary ?? false,
        sortOrder: img.sortOrder ?? 0,
        createdAt: img.createdAt,
      })),
      currentStock,
    };
  }

  async searchSkus(
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
      // Step 1: 관계 테이블 조건으로 SKU ID 필터링
      let skuIdFilter: string[] | undefined;

      // barcode 조건으로 SKU ID 찾기
      if (query.barcode) {
        const skuIdsFromBarcode = await trx
          .selectDistinct({ skuId: wmsTables.skuBarcodes.skuId })
          .from(wmsTables.skuBarcodes)
          .where(eq(wmsTables.skuBarcodes.barcode, query.barcode));
        skuIdFilter = skuIdsFromBarcode.map((row) => row.skuId);
        if (skuIdFilter.length === 0) return [];
      }

      // supplierName 조건으로 SKU ID 찾기
      if (query.supplierName) {
        const skuIdsFromSupplier = await trx
          .selectDistinct({ skuId: wmsTables.skuSuppliers.skuId })
          .from(wmsTables.skuSuppliers)
          .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
          .where(sql`${wmsTables.suppliers.name} ILIKE ${'%' + query.supplierName + '%'}`);

        const supplierSkuIds = skuIdsFromSupplier.map((row) => row.skuId);
        if (supplierSkuIds.length === 0) return [];

        // 이전 필터와 교집합
        skuIdFilter = skuIdFilter ? skuIdFilter.filter((id) => supplierSkuIds.includes(id)) : supplierSkuIds;

        if (skuIdFilter.length === 0) return [];
      }

      // Step 2: 메인 테이블 조건 구성
      const conditions: SQL[] = [];

      conditions.push(eq(wmsTables.skus.isDeleted, false));

      if (query.id) conditions.push(eq(wmsTables.skus.id, query.id));
      if (query.code) conditions.push(eq(wmsTables.skus.code, query.code));
      if (query.groupId) conditions.push(eq(wmsTables.skus.groupId, query.groupId));
      if (query.name) conditions.push(sql`${wmsTables.skus.name} ILIKE ${'%' + query.name + '%'}`);
      if (skuIdFilter && skuIdFilter.length > 0) {
        conditions.push(inArray(wmsTables.skus.id, skuIdFilter));
      }

      // Step 3: tx.select를 사용한 데이터 조회 (N+1 문제 회피)

      // 3-1: 메인 SKU 데이터 조회
      const skus = await trx
        .select()
        .from(wmsTables.skus)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      if (skus.length === 0) return [];

      const skuIds = skus.map((sku) => sku.id);
      const uniqueGroupIds = [...new Set(skus.map((sku) => sku.groupId).filter((id): id is string => id !== null))];

      // 3-2: SKU Groups 조회 (있는 경우만)
      const groups =
        uniqueGroupIds.length > 0
          ? await trx.select().from(wmsTables.skuGroups).where(inArray(wmsTables.skuGroups.id, uniqueGroupIds))
          : [];

      const groupMap = new Map(groups.map((g) => [g.id, g]));

      // 3-3: SKU Barcodes 조회 (IN 쿼리로 N+1 회피)
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

      // 3-4: SKU Suppliers with Supplier info (JOIN으로 한 번에)
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
        if (!suppliersBySkuId.has(ss.skuId)) {
          suppliersBySkuId.set(ss.skuId, []);
        }
        suppliersBySkuId.get(ss.skuId)!.push({
          id: ss.supplierId,
          name: ss.supplierName,
        });
      }

      // 3-5: SKU Categories with Category info (JOIN으로 한 번에)
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
        if (!categoriesBySkuId.has(sc.skuId)) {
          categoriesBySkuId.set(sc.skuId, []);
        }
        categoriesBySkuId.get(sc.skuId)!.push(sc.categoryName);
      }

      // Step 4: DTO 형식으로 변환
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

  /**
   * Advanced inventory search with comprehensive filtering
   */
  async searchInventoryAdvanced(
    filters: AdvancedInventoryFiltersDto,
    tx?: DbTx,
  ): Promise<{
    items: SkuResponseDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.inTx(async (trx) => {
      // displayMode는 warehouseId와 함께만 사용 가능
      if (filters.displayMode && !filters.warehouseId) {
        throw new BadRequestException('displayMode filter requires warehouseId to be specified');
      }

      // Build where conditions
      const conditions: SQL[] = [];

      conditions.push(eq(wmsTables.skus.isDeleted, false));

      // Search by name or code
      if (filters.search) {
        conditions.push(
          or(like(wmsTables.skus.name, `%${filters.search}%`), like(wmsTables.skus.code, `%${filters.search}%`))!,
        );
      }

      // Barcode search - find SKU IDs from skuBarcodes table
      if (filters.barcode) {
        const skuIdsWithBarcode = await trx
          .selectDistinct({ skuId: wmsTables.skuBarcodes.skuId })
          .from(wmsTables.skuBarcodes)
          .where(eq(wmsTables.skuBarcodes.barcode, filters.barcode));

        if (skuIdsWithBarcode.length === 0) {
          // No SKUs with this barcode, return empty result
          return {
            items: [],
            total: 0,
            limit: filters.limit ?? 50,
            offset: filters.offset ?? 0,
          };
        }

        conditions.push(sql`${wmsTables.skus.id} IN ${skuIdsWithBarcode.map((r) => r.skuId)}`);
      }

      // Stock type
      if (filters.stockType) {
        conditions.push(eq(wmsTables.skus.stockType, filters.stockType));
      }

      // ===== WMS-INTERNAL GROUPING FILTERS =====

      // Group ID filter
      if (filters.groupId) {
        conditions.push(eq(wmsTables.skus.groupId, filters.groupId));
      }

      // Group Code filter (requires lookup to sku_groups)
      if (filters.groupCode) {
        const [group] = await trx
          .select({ id: wmsTables.skuGroups.id })
          .from(wmsTables.skuGroups)
          .where(eq(wmsTables.skuGroups.code, filters.groupCode))
          .limit(1);

        if (group) {
          conditions.push(eq(wmsTables.skus.groupId, group.id));
        } else {
          // No matching group code - return empty results
          return {
            items: [],
            total: 0,
            limit: filters.limit ?? 50,
            offset: filters.offset ?? 0,
          };
        }
      }

      // Grouped/ungrouped filter
      if (filters.isGrouped !== undefined) {
        conditions.push(filters.isGrouped ? isNotNull(wmsTables.skus.groupId) : isNull(wmsTables.skus.groupId));
      }

      // Supplier filter
      if (filters.supplierId) {
        conditions.push(
          inArray(
            wmsTables.skus.id,
            trx
              .select({ id: wmsTables.skuSuppliers.skuId })
              .from(wmsTables.skuSuppliers)
              .where(eq(wmsTables.skuSuppliers.supplierId, filters.supplierId)),
          ),
        );
      }

      // Location filter
      if (filters.locationId) {
        conditions.push(eq(wmsTables.skus.primaryLocationId, filters.locationId));
      }

      // Date range
      if (filters.startDate) {
        conditions.push(gte(wmsTables.skus.createdAt, new Date(filters.startDate)));
      }
      if (filters.endDate) {
        conditions.push(lte(wmsTables.skus.createdAt, new Date(filters.endDate)));
      }

      // stockSummary JOIN 조건: warehouseId가 있으면 해당 창고만 JOIN
      const stockSummaryJoinCondition = filters.warehouseId
        ? and(
            eq(wmsTables.skus.id, wmsSchema.stockSummary.skuId),
            eq(wmsSchema.stockSummary.warehouseId, filters.warehouseId),
          )
        : eq(wmsTables.skus.id, wmsSchema.stockSummary.skuId);

      // Build base query with stock summary join
      const skuIdQuery = trx
        .select({ skuId: wmsTables.skus.id })
        .from(wmsTables.skus)
        .leftJoin(wmsSchema.stockSummary, stockSummaryJoinCondition)
        .groupBy(wmsTables.skus.id);

      // Display mode filters (warehouseId와 함께만 사용 가능)
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

      // Sorting
      const sortField = filters.sortBy ?? 'createdAt';
      const sortDirection = filters.sortOrder ?? 'desc';
      const orderCondition = sortDirection === 'asc' ? asc(wmsTables.skus[sortField]) : desc(wmsTables.skus[sortField]);

      // Execute query to get distinct SKU IDs
      const skuIdResults = await skuIdQuery
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderCondition)
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0);

      const uniqueSkuIds = skuIdResults.map((row) => row.skuId);

      // Count total (동일한 conditions 사용, 중복 제거)
      const [countResult] = await trx
        .select({ count: sql<number>`count(DISTINCT ${wmsTables.skus.id})` })
        .from(wmsTables.skus)
        .leftJoin(wmsSchema.stockSummary, stockSummaryJoinCondition)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const total = Number(countResult?.count ?? 0);

      // Map to DTOs (warehouseId 전달)
      const items = await Promise.all(uniqueSkuIds.map((skuId) => this.getSkuById(skuId, trx, filters.warehouseId)));

      return {
        items,
        total,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      };
    }, tx);
  }

  async addBarcode(skuId: string, addBarcodeDto: AddBarcodeDto, tx?: DbTx): Promise<SkuBarcode> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const newBarcode = await this.inTx(async (trx) => {
      const [existingBarcode] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.barcode, addBarcodeDto.barcode))
        .limit(1);

      if (existingBarcode) {
        throw new ConflictException(`Barcode ${addBarcodeDto.barcode} already exists`);
      }

      const [newBarcode] = await trx
        .insert(wmsTables.skuBarcodes)
        .values({
          skuId,
          barcode: addBarcodeDto.barcode,
          isPrimary: false,
          packingUnit: addBarcodeDto.packingUnit,
        })
        .returning();

      return newBarcode;
    }, tx);

    return newBarcode;
  }

  async removeBarcode(skuId: string, barcodeId: string, tx?: DbTx): Promise<void> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const barcode = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(and(eq(wmsTables.skuBarcodes.id, barcodeId), eq(wmsTables.skuBarcodes.skuId, skuId)))
        .limit(1);
      return row;
    }, tx);

    if (!barcode) {
      throw new NotFoundException(`Barcode with ID ${barcodeId} not found for SKU ${skuId}`);
    }

    if (barcode.isPrimary) {
      throw new BadRequestException('Cannot remove primary barcode');
    }

    await this.inTx(
      async (trx) => trx.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.id, barcodeId)),
      tx,
    );

    this.logger.log(`Barcode ${barcodeId} removed from SKU ${skuId}`);
  }

  // ****************************************************************
  // 재고 관리 도메인 — projection 책임은 StockProjectionModule 로 분리됨.
  // ****************************************************************

  async findSkuById(skuId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [row] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, skuId)).limit(1);
      return row;
    }, tx);
  }

  // ****************************************************************
  // Private Helper Methods
  // ****************************************************************

  private async _generateSkuCode(tx: DbTx): Promise<string> {
    const prefix = 'P';

    const [lastSku] = await tx
      .select({ code: wmsTables.skus.code })
      .from(wmsTables.skus)
      .where(like(wmsTables.skus.code, `${prefix}%`))
      .orderBy(desc(wmsTables.skus.code))
      .limit(1);

    let nextNumber = 1;
    if (lastSku) {
      const numericPart = lastSku.code.substring(prefix.length);
      const lastNumber = parseInt(numericPart, 10);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }

    return `${prefix}${String(nextNumber).padStart(5, '0')}`;
  }

  private _calculateAvailableQuantity(realQuantity: number, reservedQuantity: number): number {
    return realQuantity - reservedQuantity;
  }

  private async _ensureSinglePrimaryBarcode(skuId: string, tx: DbTx): Promise<void> {
    const primaries = await tx
      .select()
      .from(wmsTables.skuBarcodes)
      .where(and(eq(wmsTables.skuBarcodes.skuId, skuId), eq(wmsTables.skuBarcodes.isPrimary, true)));

    if (primaries.length !== 1) {
      throw new Error(`SKU ${skuId} must have exactly one primary barcode, found ${primaries.length}`);
    }
  }

  private async _ensureDefaultHoldersExist() {
    try {
      const defaultHolder = HOLDER_CONSTANTS.DEFAULT_HOLDER;

      const existingHolder = await this.inTx(async (trx) => {
        const [row] = await trx
          .select()
          .from(wmsTables.holders)
          .where(eq(wmsTables.holders.id, defaultHolder.id))
          .limit(1);
        return row;
      });

      if (!existingHolder) {
        await this.inTx(async (trx) => {
          await trx.insert(wmsTables.holders).values({
            id: defaultHolder.id,
            name: defaultHolder.name,
            isOurAsset: defaultHolder.isOurAsset,
          });
        });
        this.logger.log(`기본 Holder 생성: ${defaultHolder.name}`);
      }
    } catch (error) {
      this.logger.error('기본 Holder 생성 중 오류 발생:', error);
    }
  }

}
