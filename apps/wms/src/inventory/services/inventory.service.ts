import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, OnModuleInit } from '@nestjs/common';
import { InjectTypedDb, TypedDatabase, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { and, eq, isNull, or, sql, asc, like, gte, lte, isNotNull, SQL, inArray, desc } from 'drizzle-orm';
import { GetStockQueryDto } from '../dto/inventory/get-stock-query.dto';
import { AdvancedInventoryFiltersDto, StockDisplayMode } from '../dto/inventory/advanced-filters.dto';
import { CreateSkuDto, SkuCreationSource } from '../dto/sku/create-sku.dto';
import { UpdateSkuDto } from '../dto/sku/update-sku.dto';
import { AddBarcodeDto } from '../dto/sku/add-barcode.dto';
import { SkuResponseDto } from '../dto/sku/sku-response.dto';
import { SkuStockSummaryDto } from '../dto/sku/sku-stock-summary.dto';
import { CreateWarehouseDto } from '../dto/warehouse/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/warehouse/update-warehouse.dto';
import { WAREHOUSE_CONSTANTS, WarehouseType } from '../constants/warehouse.constants';
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
  ) { }

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async onModuleInit() {
    await this._ensureDefaultWarehousesExist();
  }

  // ****************************************************************
  // SKU 관리 도메인
  // ****************************************************************

  private removeUndefinedFields<T extends Record<string, any>>(obj: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(obj).filter(([_, value]) => value !== undefined && value !== null)
    ) as Partial<T>;
  }

  async createSku(createSkuDto: CreateSkuDto, tx?: DbTx): Promise<SkuResponseDto> {
    return this.inTx(async (trx) => {
      const { supplierIds, categoryIds, source, skuGroupId, imageUploadIds, currentStock, ...skuData } = createSkuDto;

      // undefined 값을 가진 필드를 제거
      const cleanSkuData = this.removeUndefinedFields(skuData);

      const [newSku] = await trx.insert(wmsTables.skus).values({
        name: skuData.name, // 필수 필드 명시적으로 보장
        ...cleanSkuData,
        ...(skuGroupId && { groupId: skuGroupId }),
        code: this._generateSkuCode(),
      }).returning();

      if (supplierIds && supplierIds.length > 0) {
        await trx.insert(wmsTables.skuSuppliers).values(
          supplierIds.map(supplierId => ({
            skuId: newSku.id,
            supplierId,
          }))
        );
      }

      if (categoryIds && categoryIds.length > 0) {
        await trx.insert(wmsTables.skuCategories).values(
          categoryIds.map(categoryId => ({
            skuId: newSku.id,
            categoryId,
          }))
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
        await trx.update(wmsTables.skus)
          .set(skuUpdatePayload)
          .where(eq(wmsTables.skus.id, skuId));
      }

      if (supplierIds !== undefined) {
        await trx.delete(wmsTables.skuSuppliers)
          .where(eq(wmsTables.skuSuppliers.skuId, skuId));

        if (supplierIds.length > 0) {
          await trx.insert(wmsTables.skuSuppliers).values(
            supplierIds.map(supplierId => ({
              skuId,
              supplierId,
            }))
          );
        }
      }

      if (categoryIds !== undefined) {
        await trx.delete(wmsTables.skuCategories)
          .where(eq(wmsTables.skuCategories.skuId, skuId));

        if (categoryIds.length > 0) {
          await trx.insert(wmsTables.skuCategories).values(
            categoryIds.map(categoryId => ({
              skuId,
              categoryId,
            }))
          );
        }
      }

      if (imageUploadIds !== undefined) {
        await trx.delete(wmsTables.skuImages)
          .where(eq(wmsTables.skuImages.skuId, skuId));

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
      // 1. SKU 존재 확인
      const sku = await this.inTx(async (trx) => {
        const [row] = await trx
          .select()
          .from(wmsTables.skus)
          .where(eq(wmsTables.skus.id, skuId))
          .limit(1);
        return row;
      }, tx);

      if (!sku) {
        throw new NotFoundException(`SKU with ID ${skuId} not found`);
      }

      // 2. 활성 재고 확인
      const [stockAgg] = await this.inTx(async (trx) => trx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}),0)` })
        .from(wmsTables.stockLedgers)
        .where(eq(wmsTables.stockLedgers.skuId, skuId))
        , tx);

      const totalStock = stockAgg?.qty ?? 0;
      if (totalStock > 0) {
        throw new ConflictException(
          `Cannot delete SKU ${skuId}: Has active stock of ${totalStock} units. ` +
          'Please adjust stock to zero before deletion.'
        );
      }

      // 3. 상품 매칭 사용 확인
      const matchings = await this.inTx(async (trx) => trx
        .select({ productMatchingId: wmsTables.productVariantSkuLinks.productMatchingId })
        .from(wmsTables.productVariantSkuLinks)
        .where(eq(wmsTables.productVariantSkuLinks.skuId, skuId))
        , tx);

      if (matchings.length > 0) {
        const matchingIds = matchings.map(m => m.productMatchingId).join(', ');
        throw new ConflictException(
          `Cannot delete SKU ${skuId}: Used in ${matchings.length} product matching(s): ${matchingIds}. ` +
          'Please remove from product matchings first.'
        );
      }

      // 4. 예약 확인
      const reservations = await this.inTx(async (trx) => trx
        .select({ id: wmsTables.stockReservations.id })
        .from(wmsTables.stockReservations)
        .where(and(
          eq(wmsTables.stockReservations.skuId, skuId),
          eq(wmsTables.stockReservations.status, 'confirmed')
        ))
        , tx);

      if (reservations.length > 0) {
        throw new ConflictException(
          `Cannot delete SKU ${skuId}: Has ${reservations.length} active reservation(s). ` +
          'Please release all reservations first.'
        );
      }

      // 5. 삭제 실행
      const deleteResult = await this.inTx(async (trx) => trx.delete(wmsTables.skus)
        .where(eq(wmsTables.skus.id, skuId))
        .returning(), tx);

      if (deleteResult.length === 0) {
        throw new ConflictException(`Failed to delete SKU ${skuId}. It may have been deleted by another process.`);
      }

      this.logger.log(`SKU ${skuId} (${sku.name}) deleted successfully`);

    } catch (error) {
      this.logger.error(`Failed to delete SKU ${skuId}:`, error);
      throw error;
    }
  }

  async getSkuById(skuId: string, tx?: DbTx, warehouseId?: string): Promise<SkuResponseDto> {
    const result = await this.inTx(async (trx) => {
      const [result] = await trx
        .select()
        .from(wmsTables.skus)
        .leftJoin(
          wmsTables.skuGroups,
          eq(wmsTables.skus.groupId, wmsTables.skuGroups.id)
        )
        .where(eq(wmsTables.skus.id, skuId))
        .limit(1);

      if (!result) {
        return { sku: undefined, group: undefined };
      }

      return { sku: result.skus, group: result.sku_groups };
    }, tx);

    if (!result.sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const barcodes = await this.inTx(async (trx) => trx
      .select()
      .from(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.skuId, skuId))
      , tx);

    const suppliers = await this.inTx(async (trx) => trx
      .select({
        id: wmsTables.suppliers.id,
        name: wmsTables.suppliers.name,
      })
      .from(wmsTables.skuSuppliers)
      .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
      .where(eq(wmsTables.skuSuppliers.skuId, skuId))
      , tx);

    const categories = await this.inTx(async (trx) => trx
      .select({
        name: wmsTables.categories.name,
      })
      .from(wmsTables.skuCategories)
      .innerJoin(wmsTables.categories, eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id))
      .where(eq(wmsTables.skuCategories.skuId, skuId))
      , tx);

    const images = await this.inTx(async (trx) => trx
      .select()
      .from(wmsTables.skuImages)
      .where(eq(wmsTables.skuImages.skuId, skuId))
      .orderBy(wmsTables.skuImages.sortOrder)
      , tx);

    // 재고 정보 조회
    let currentStock = 0;
    if (warehouseId) {
      // 특정 창고의 재고만 조회
      const [stockInfo] = await this.inTx(async (trx) => trx
        .select({ onHandQty: wmsSchema.stockSummary.onHandQty })
        .from(wmsSchema.stockSummary)
        .where(
          and(
            eq(wmsSchema.stockSummary.skuId, skuId),
            eq(wmsSchema.stockSummary.warehouseId, warehouseId)
          )
        )
        .limit(1)
        , tx);

      currentStock = stockInfo?.onHandQty ?? 0;
    } else {
      // 전체 창고 합계
      const [stockInfo] = await this.inTx(async (trx) => trx
        .select({
          total: sql<number>`COALESCE(SUM(${wmsSchema.stockSummary.onHandQty}), 0)`
        })
        .from(wmsSchema.stockSummary)
        .where(eq(wmsSchema.stockSummary.skuId, skuId))
        , tx);

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
      barcodes: barcodes.map(b => ({
        id: b.id,
        barcode: b.barcode,
        barcodeType: b.barcodeType,
        packingUnit: b.packingUnit ?? undefined,
      })),
      suppliers: suppliers,
      categoryNames: categories.map(c => c.name),
      images: images.map(img => ({
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

  async searchSkus(query: {
    id?: string;
    code?: string;
    barcode?: string;
    name?: string;
    supplierName?: string;
    inventoryManagement?: boolean;
    groupId?: string;
  }, tx?: DbTx): Promise<SkuResponseDto[]> {
    return this.inTx(async (trx) => {
      // Step 1: 관계 테이블 조건으로 SKU ID 필터링
      let skuIdFilter: string[] | undefined;

      // barcode 조건으로 SKU ID 찾기
      if (query.barcode) {
        const skuIdsFromBarcode = await trx
          .selectDistinct({ skuId: wmsTables.skus.id })
          .from(wmsTables.skus)
          .leftJoin(wmsTables.skuBarcodes, eq(wmsTables.skus.id, wmsTables.skuBarcodes.skuId))
          .where(
            or(
              eq(wmsTables.skus.defaultBarcode, query.barcode),
              eq(wmsTables.skuBarcodes.barcode, query.barcode)
            )
          );
        skuIdFilter = skuIdsFromBarcode.map(row => row.skuId);
        if (skuIdFilter.length === 0) return [];
      }

      // supplierName 조건으로 SKU ID 찾기
      if (query.supplierName) {
        const skuIdsFromSupplier = await trx
          .selectDistinct({ skuId: wmsTables.skuSuppliers.skuId })
          .from(wmsTables.skuSuppliers)
          .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
          .where(sql`${wmsTables.suppliers.name} ILIKE ${'%' + query.supplierName + '%'}`);

        const supplierSkuIds = skuIdsFromSupplier.map(row => row.skuId);
        if (supplierSkuIds.length === 0) return [];

        // 이전 필터와 교집합
        skuIdFilter = skuIdFilter
          ? skuIdFilter.filter(id => supplierSkuIds.includes(id))
          : supplierSkuIds;

        if (skuIdFilter.length === 0) return [];
      }

      // Step 2: 메인 테이블 조건 구성
      const conditions: SQL[] = [];

      if (query.id) conditions.push(eq(wmsTables.skus.id, query.id));
      if (query.code) conditions.push(eq(wmsTables.skus.code, query.code));
      if (query.groupId) conditions.push(eq(wmsTables.skus.groupId, query.groupId));
      if (query.name) conditions.push(sql`${wmsTables.skus.name} ILIKE ${'%' + query.name + '%'}`);
      if (skuIdFilter && skuIdFilter.length > 0) {
        conditions.push(inArray(wmsTables.skus.id, skuIdFilter));
      }

      // Step 3: Relational query로 데이터 조회 (Cartesian product 없음!)
      const skus = await trx.query.skus.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        with: {
          skuBarcodes: true,
          skuSuppliers: {
            with: {
              supplier: true,
            },
          },
          skuCategories: {
            with: {
              category: true,
            },
          },
          group: true,
        },
      });

      // Step 4: DTO 형식으로 변환
      return skus.map(sku => ({
        ...sku,
        skuGroup: sku.group ?? undefined,
        barcodes: sku.skuBarcodes.map(bc => ({
          id: bc.id,
          barcode: bc.barcode,
          barcodeType: bc.barcodeType,
          packingUnit: bc.packingUnit,
        })),
        suppliers: sku.skuSuppliers.map(ss => ({
          id: ss.supplier.id,
          name: ss.supplier.name,
        })),
        categoryNames: sku.skuCategories.map(sc => sc.category.name),
      }));
    }, tx);
  }

  /**
   * Advanced inventory search with comprehensive filtering
   */
  async searchInventoryAdvanced(
    filters: AdvancedInventoryFiltersDto,
    tx?: DbTx
  ): Promise<{
    items: SkuResponseDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.inTx(async (trx) => {
      // displayMode는 warehouseId와 함께만 사용 가능
      if (filters.displayMode && !filters.warehouseId) {
        throw new BadRequestException(
          'displayMode filter requires warehouseId to be specified'
        );
      }

      // Build where conditions
      const conditions: SQL[] = [];

      // Search by name or code
      if (filters.search) {
        conditions.push(
          or(
            like(wmsTables.skus.name, `%${filters.search}%`),
            like(wmsTables.skus.code, `%${filters.search}%`)
          )!
        );
      }

      // Barcode search
      if (filters.barcode) {
        conditions.push(eq(wmsTables.skus.defaultBarcode, filters.barcode));
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
        conditions.push(
          filters.isGrouped
            ? isNotNull(wmsTables.skus.groupId)
            : isNull(wmsTables.skus.groupId)
        );
      }

      // Supplier filter
      if (filters.supplierId) {
        conditions.push(
          inArray(
            wmsTables.skus.id,
            trx.select({ id: wmsTables.skuSuppliers.skuId })
              .from(wmsTables.skuSuppliers)
              .where(eq(wmsTables.skuSuppliers.supplierId, filters.supplierId))
          )
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
          eq(wmsSchema.stockSummary.warehouseId, filters.warehouseId)
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
            conditions.push(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) < ${wmsTables.skus.safetyStock}`
            );
            break;
          case StockDisplayMode.WITH_STOCK:
            conditions.push(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) > 0`
            );
            break;
          case StockDisplayMode.OUT_OF_STOCK:
            conditions.push(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) = 0`
            );
            break;
        }
      }

      // Sorting
      const sortField = filters.sortBy ?? 'createdAt';
      const sortDirection = filters.sortOrder ?? 'desc';
      const orderCondition = sortDirection === 'asc'
        ? asc(wmsTables.skus[sortField])
        : desc(wmsTables.skus[sortField]);

      // Execute query to get distinct SKU IDs
      const skuIdResults = await skuIdQuery
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderCondition)
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0);

      const uniqueSkuIds = skuIdResults.map(row => row.skuId);

      // Count total (동일한 conditions 사용, 중복 제거)
      const [countResult] = await trx
        .select({ count: sql<number>`count(DISTINCT ${wmsTables.skus.id})` })
        .from(wmsTables.skus)
        .leftJoin(wmsSchema.stockSummary, stockSummaryJoinCondition)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const total = Number(countResult?.count ?? 0);

      // Map to DTOs (warehouseId 전달)
      const items = await Promise.all(
        uniqueSkuIds.map(skuId => this.getSkuById(skuId, trx, filters.warehouseId))
      );

      return {
        items,
        total,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      };
    }, tx);
  }

  async addBarcode(skuId: string, addBarcodeDto: AddBarcodeDto, tx?: DbTx): Promise<void> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const existingBarcode = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.barcode, addBarcodeDto.barcode))
        .limit(1);
      return row;
    }, tx);

    if (existingBarcode) {
      throw new ConflictException(`Barcode ${addBarcodeDto.barcode} already exists`);
    }

    await this.inTx(async (trx) => trx.insert(wmsTables.skuBarcodes).values({
      skuId,
      barcode: addBarcodeDto.barcode,
      barcodeType: addBarcodeDto.barcodeType || 'standard',
      packingUnit: addBarcodeDto.packingUnit,
    }), tx);

    this.logger.log(`Barcode ${addBarcodeDto.barcode} added to SKU ${skuId}`);
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
        .where(and(
          eq(wmsTables.skuBarcodes.id, barcodeId),
          eq(wmsTables.skuBarcodes.skuId, skuId)
        ))
        .limit(1);
      return row;
    }, tx);

    if (!barcode) {
      throw new NotFoundException(`Barcode with ID ${barcodeId} not found for SKU ${skuId}`);
    }

    if (sku.defaultBarcode === barcode.barcode) {
      throw new BadRequestException('Cannot remove default barcode');
    }

    await this.inTx(async (trx) => trx.delete(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.id, barcodeId)), tx);

    this.logger.log(`Barcode ${barcodeId} removed from SKU ${skuId}`);
  }


  // ****************************************************************
  // 재고 관리 도메인
  // ****************************************************************

  async getCurrentStock(query: GetStockQueryDto, tx?: DbTx) {
    const { skuId, warehouseId, locationId, asOfTimestamp } = query;
    if (asOfTimestamp) {
      throw new BadRequestException('asOfTimestamp 기반 조회는 아직 지원되지 않습니다.');
    }

    const rows = await this.inTx(async (trx) => trx
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        warehouseId: wmsTables.stockLedgers.warehouseId,
        locationId: wmsTables.stockLedgers.locationId,
        stockState: wmsTables.stockLedgers.stockState,
        quantity: wmsTables.stockLedgers.qty,
      })
      .from(wmsTables.stockLedgers)
      .where(and(
        skuId ? eq(wmsTables.stockLedgers.skuId, skuId) : undefined,
        warehouseId ? eq(wmsTables.stockLedgers.warehouseId, warehouseId) : undefined,
        locationId ? eq(wmsTables.stockLedgers.locationId, locationId) : undefined,
      )), tx);

    return rows;
  }

  async getTotalStockBySku(skuId: string, tx?: DbTx): Promise<{
    skuId: string;
    totalRealQuantity: number;
    totalReservedQuantity: number;
    totalAvailableQuantity: number;
  }> {
    const summaries = await this.inTx(async (trx) => trx
      .select()
      .from(wmsSchema.stockSummary)
      .where(eq(wmsSchema.stockSummary.skuId, skuId))
      , tx);

    const total = summaries.reduce(
      (acc, summary) => ({
        totalRealQuantity: acc.totalRealQuantity + summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
        totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQty,
        totalAvailableQuantity: acc.totalAvailableQuantity + summary.availableQty,
      }),
      { totalRealQuantity: 0, totalReservedQuantity: 0, totalAvailableQuantity: 0 }
    );

    return {
      skuId,
      totalRealQuantity: total.totalRealQuantity,
      totalReservedQuantity: total.totalReservedQuantity,
      totalAvailableQuantity: total.totalAvailableQuantity,
    };
  }

  async getStockBySkuAndWarehouse(skuId: string, warehouseId: string, tx?: DbTx) {
    const summary = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsSchema.stockSummary)
        .where(and(
          eq(wmsSchema.stockSummary.skuId, skuId),
          eq(wmsSchema.stockSummary.warehouseId, warehouseId)
        ))
        .limit(1);
      return row;
    }, tx);

    const details = await this.inTx(async (trx) => trx
      .select({
        locationId: wmsTables.stockLedgers.locationId,
        stockState: wmsTables.stockLedgers.stockState,
        quantity: wmsTables.stockLedgers.qty,
      })
      .from(wmsTables.stockLedgers)
      .where(and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
      )), tx);

    return {
      summary: summary ? {
        currentQuantity: summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
        availableQuantity: summary.availableQty,
        reservedQuantity: summary.reservedQty,
        inboundPendingQuantity: summary.inboundPendingQty,
        outboundPendingQuantity: summary.onOrderQty,
        movingQuantity: summary.inTransferQty,
        defectiveQuantity: summary.defectiveQty,
        returnPendingQuantity: summary.transferPendingQty,
        lastUpdated: summary.lastCalculatedAt,
      } : null,
      details,
    };
  }

  async getStockHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
    return this.eventStore.getEventHistory(skuId, warehouseId, startDate, endDate);
  }

  async getQuickStockSummary(skuId?: string, warehouseId?: string, tx?: DbTx) {
    const conditions: SQL[] = [];
    if (skuId) conditions.push(eq(wmsSchema.stockSummary.skuId, skuId));
    if (warehouseId) conditions.push(eq(wmsSchema.stockSummary.warehouseId, warehouseId));

    const summaries = await this.inTx(async (trx) => trx
      .select()
      .from(wmsSchema.stockSummary)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      , tx);

    return summaries;
  }

  async adjustStockManually(stockId: string, delta: number, reason: string) {
    throw new BadRequestException('stockId 기반 수동 조정은 더 이상 지원하지 않습니다.');
  }

  async getSkuStockSummary(skuId: string, tx?: DbTx): Promise<SkuStockSummaryDto> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const summaries = await this.inTx(async (trx) => trx
      .select()
      .from(wmsSchema.stockSummary)
      .where(eq(wmsSchema.stockSummary.skuId, skuId))
      , tx);

    const warehouseIds = summaries.map(summary => summary.warehouseId);
    const warehouses = await this.inTx(async (trx) => trx
      .select()
      .from(wmsTables.warehouses)
      .where(sql`${wmsTables.warehouses.id} = ANY(${warehouseIds})`)
      , tx);

    const warehouseMap = new Map(warehouses.map(warehouse => [warehouse.id, warehouse]));

    const warehouseStocks = summaries.map(summary => ({
      warehouseId: summary.warehouseId,
      warehouseName: warehouseMap.get(summary.warehouseId)?.name || 'Unknown Warehouse',
      realQuantity: summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
      reservedQuantity: summary.reservedQty,
      availableQuantity: summary.availableQty,
    }));

    const totals = summaries.reduce(
      (acc, summary) => ({
        totalRealQuantity: acc.totalRealQuantity + summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
        totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQty,
        totalAvailableQuantity: acc.totalAvailableQuantity + summary.availableQty,
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
      warehouseStocks: warehouseStocks,
    };
  }

  // 이벤트 관련 메서드들은 StockEventStore로 위임
  async cancelStockEvent(eventId: string, reason: string): Promise<void> {
    await this.eventStore.reverseEvent(eventId, reason);
  }

  async rebuildStockSummary(skuId: string, warehouseId: string): Promise<void> {
    throw new BadRequestException('재고 요약 재구축은 추후 프로젝션 서비스로 제공됩니다.');
  }

  // ****************************************************************
  // 창고 관리 도메인
  // ****************************************************************

  async createWarehouse(createWarehouseDto: CreateWarehouseDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [newWarehouse] = await trx.insert(wmsTables.warehouses).values({
        name: createWarehouseDto.name,
        type: createWarehouseDto.type || 'domestic',
        location: createWarehouseDto.location,
      }).returning();

      this.logger.log(`새 창고 생성: ${newWarehouse.name} (ID: ${newWarehouse.id})`);
      // 창고 생성 직후 시스템 로케이션 보장 (동일 트랜잭션)
      await this.locationService.ensureSystemLocations(newWarehouse.id, trx);
      return newWarehouse;
    }, tx);
  }

  async findAllWarehouses(tx?: DbTx) {
    return this.inTx(async (trx) => trx
      .select()
      .from(wmsTables.warehouses)
      .orderBy(asc(wmsTables.warehouses.name))
      , tx);
  }

  async findOneWarehouse(id: string, tx?: DbTx) {
    const warehouse = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.id, id))
        .limit(1);
      return row;
    }, tx);

    if (!warehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    return warehouse;
  }

  async updateWarehouse(id: string, updateWarehouseDto: UpdateWarehouseDto, tx?: DbTx) {
    const [updatedWarehouse] = await this.inTx(async (trx) => trx.update(wmsTables.warehouses)
      .set({
        ...updateWarehouseDto,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.warehouses.id, id))
      .returning(), tx).then(r => r);

    if (!updatedWarehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    this.logger.log(`창고 정보 업데이트: ${updatedWarehouse.name}`);
    return updatedWarehouse;
  }

  async removeWarehouse(id: string, tx?: DbTx) {
    if (id === WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id ||
      id === WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id) {
      throw new Error('기본 창고는 삭제할 수 없습니다.');
    }

    const inUse = await this._isWarehouseInUse(id);
    if (inUse) {
      throw new Error('사용 중인 창고는 삭제할 수 없습니다.');
    }

    const [deletedWarehouse] = await this.inTx(async (trx) => trx.delete(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.id, id))
      .returning(), tx).then(r => r);

    if (!deletedWarehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    return deletedWarehouse;
  }

  async getWarehouseStockSummary(warehouseId: string) {
    const rows = await this.db.select({
      skuId: wmsTables.stockLedgers.skuId,
      skuName: wmsTables.skus.name,
      skuCode: wmsTables.skus.code,
      totalQuantity: sql<number>`sum(${wmsTables.stockLedgers.qty})`,
      locationCount: sql<number>`count(distinct ${wmsTables.stockLedgers.locationId})`,
    })
      .from(wmsTables.stockLedgers)
      .innerJoin(wmsTables.skus, eq(wmsTables.stockLedgers.skuId, wmsTables.skus.id))
      .where(eq(wmsTables.stockLedgers.warehouseId, warehouseId))
      .groupBy(wmsTables.stockLedgers.skuId, wmsTables.skus.name, wmsTables.skus.code);

    return {
      warehouseId,
      summary: rows,
      totalSkus: rows.length,
      totalQuantity: rows.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalAvailable: rows.reduce((sum, item) => sum + item.totalQuantity, 0),
    };
  }


  async findSkuById(skuId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, skuId))
        .limit(1);
      return row;
    }, tx);
  }

  getDefaultWarehouseIdByType(type: WarehouseType): string {
    switch (type) {
      case 'domestic':
        return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
      case 'overseas':
        return WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id;
      default:
        return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
    }
  }

  getDefaultWarehouseId(): string {
    return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
  }

  // ****************************************************************
  // Private Helper Methods
  // ****************************************************************

  private _generateSkuCode(): string {
    const prefix = 'P';
    const numericPart = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const alphaPart = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    return `${prefix}${numericPart}${alphaPart}`;
  }

  private async _generateAndSetDefaultBarcode(skuId: string, db: DbTx): Promise<string> {
    const generatedBarcode = `SKU_B_${skuId.substring(0, 8).toUpperCase()}_${Date.now()}`;

    const [newSkuBarcode] = await db.insert(wmsTables.skuBarcodes).values({
      skuId,
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

  private _calculateAvailableQuantity(realQuantity: number, reservedQuantity: number): number {
    return realQuantity - reservedQuantity;
  }

  private _canUseStockSummary(query: GetStockQueryDto): boolean {
    // locationId나 expiryDate 등 상세 조건이 없으면 summary 사용 가능
    return !query.locationId && !query.asOfTimestamp && !query.stockType;
  }

  private async _ensureDefaultWarehousesExist() {
    try {
      const defaultWarehouses = [
        WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE,
        WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE,
      ];

      for (const warehouseData of defaultWarehouses) {
        const existingWarehouse = await this.inTx(async (trx) => {
          const [row] = await trx
            .select()
            .from(wmsTables.warehouses)
            .where(eq(wmsTables.warehouses.id, warehouseData.id))
            .limit(1);
          return row;
        });

        if (!existingWarehouse) {
          await this.inTx(async (trx) => {
            await trx.insert(wmsTables.warehouses).values({
              id: warehouseData.id,
              name: warehouseData.name,
              type: warehouseData.type,
              location: warehouseData.location,
            });
          });
          this.logger.log(`기본 창고 생성: ${warehouseData.name}`);
        }
      }
    } catch (error) {
      this.logger.error('기본 창고 생성 중 오류 발생:', error);
    }
  }

  private async _isWarehouseInUse(warehouseId: string): Promise<boolean> {
    const [row] = await this.db.select({ count: sql<number>`count(*)` })
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.warehouseId, warehouseId));

    return (row?.count ?? 0) > 0;
  }
}