import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import {
  wmsTables,
  wmsSchema,
  DbTx,
} from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import {
  and,
  eq,
  isNull,
  or,
  sql,
  asc,
  like,
  gte,
  lte,
  isNotNull,
  SQL,
  inArray,
} from 'drizzle-orm';
import { GetStockQueryDto } from '../dto/inventory/get-stock-query.dto';
import {
  AdvancedInventoryFiltersDto,
  StockDisplayMode,
} from '../dto/inventory/advanced-filters.dto';
import { CreateSkuDto, SkuCreationSource } from '../dto/sku/create-sku.dto';
import { UpdateSkuDto } from '../dto/sku/update-sku.dto';
import { AddBarcodeDto } from '../dto/sku/add-barcode.dto';
import { SkuResponseDto } from '../dto/sku/sku-response.dto';
import { SkuStockSummaryDto } from '../dto/sku/sku-stock-summary.dto';
import { CreateWarehouseDto } from '../dto/warehouse/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/warehouse/update-warehouse.dto';
import {
  WAREHOUSE_CONSTANTS,
  WarehouseType,
} from '../constants/warehouse.constants';
import { StockEventStore } from '../repositories/stock-event.store';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
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
    await this._ensureDefaultWarehousesExist();
    await this._ensureDefaultHolderExists();
  }

  // ****************************************************************
  // SKU 관리 도메인
  // ****************************************************************

  async createSku(
    createSkuDto: CreateSkuDto,
    tx?: DbTx,
  ): Promise<SkuResponseDto> {
    this.logger.log(
      `[createSku] 시작 - name: ${createSkuDto.name}, masterId: ${createSkuDto.masterId || '없음'}`,
    );
    return this.inTx(async (trx) => {
      try {
        const { supplierIds, categoryIds } = createSkuDto;
        this.logger.log(`[createSku] 트랜잭션 시작`);

        // UUID 형식 검증 헬퍼
        const isValidUUID = (str: string): boolean => {
          const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          return uuidRegex.test(str);
        };

        // 외래키 참조 검증 (UUID 형식 검증 먼저)
        if (createSkuDto.deliveryProfileId) {
          if (!isValidUUID(createSkuDto.deliveryProfileId)) {
            throw new Error(
              `Invalid UUID format for deliveryProfileId: ${createSkuDto.deliveryProfileId}`,
            );
          }
          const [deliveryProfile] = await trx
            .select({ id: wmsTables.deliveryProfiles.id })
            .from(wmsTables.deliveryProfiles)
            .where(
              eq(wmsTables.deliveryProfiles.id, createSkuDto.deliveryProfileId),
            )
            .limit(1);
          if (!deliveryProfile) {
            throw new Error(
              `Delivery profile not found: ${createSkuDto.deliveryProfileId}`,
            );
          }
        }

        if (createSkuDto.logisticsPartnerId) {
          if (!isValidUUID(createSkuDto.logisticsPartnerId)) {
            throw new Error(
              `Invalid UUID format for logisticsPartnerId: ${createSkuDto.logisticsPartnerId}`,
            );
          }
          const [logisticsPartner] = await trx
            .select({ id: wmsTables.suppliers.id })
            .from(wmsTables.suppliers)
            .where(eq(wmsTables.suppliers.id, createSkuDto.logisticsPartnerId))
            .limit(1);
          if (!logisticsPartner) {
            throw new Error(
              `Logistics partner not found: ${createSkuDto.logisticsPartnerId}`,
            );
          }
        }

        if (createSkuDto.primaryLocationId) {
          if (!isValidUUID(createSkuDto.primaryLocationId)) {
            throw new Error(
              `Invalid UUID format for primaryLocationId: ${createSkuDto.primaryLocationId}`,
            );
          }
          const [primaryLocation] = await trx
            .select({ id: wmsTables.locations.id })
            .from(wmsTables.locations)
            .where(eq(wmsTables.locations.id, createSkuDto.primaryLocationId))
            .limit(1);
          if (!primaryLocation) {
            throw new Error(
              `Primary location not found: ${createSkuDto.primaryLocationId}`,
            );
          }
        }

        if (createSkuDto.secondaryLocationId) {
          if (!isValidUUID(createSkuDto.secondaryLocationId)) {
            throw new Error(
              `Invalid UUID format for secondaryLocationId: ${createSkuDto.secondaryLocationId}`,
            );
          }
          const [secondaryLocation] = await trx
            .select({ id: wmsTables.locations.id })
            .from(wmsTables.locations)
            .where(eq(wmsTables.locations.id, createSkuDto.secondaryLocationId))
            .limit(1);
          if (!secondaryLocation) {
            throw new Error(
              `Secondary location not found: ${createSkuDto.secondaryLocationId}`,
            );
          }
        }

        if (supplierIds && supplierIds.length > 0) {
          // UUID 형식 검증
          const invalidSupplierIds = supplierIds.filter(
            (id) => !isValidUUID(id),
          );
          if (invalidSupplierIds.length > 0) {
            throw new Error(
              `Invalid UUID format for supplierIds: ${invalidSupplierIds.join(', ')}`,
            );
          }
          const existingSuppliers = await trx
            .select({ id: wmsTables.suppliers.id })
            .from(wmsTables.suppliers)
            .where(sql`${wmsTables.suppliers.id} = ANY(${supplierIds})`);
          const existingSupplierIds = new Set(
            existingSuppliers.map((s) => s.id),
          );
          const missingSupplierIds = supplierIds.filter(
            (id) => !existingSupplierIds.has(id),
          );
          if (missingSupplierIds.length > 0) {
            throw new Error(
              `Suppliers not found: ${missingSupplierIds.join(', ')}`,
            );
          }
        }

        if (categoryIds && categoryIds.length > 0) {
          // UUID 형식 검증
          const invalidCategoryIds = categoryIds.filter(
            (id) => !isValidUUID(id),
          );
          if (invalidCategoryIds.length > 0) {
            throw new Error(
              `Invalid UUID format for categoryIds: ${invalidCategoryIds.join(', ')}`,
            );
          }
          const existingCategories = await trx
            .select({ id: wmsTables.categories.id })
            .from(wmsTables.categories)
            .where(sql`${wmsTables.categories.id} = ANY(${categoryIds})`);
          const existingCategoryIds = new Set(
            existingCategories.map((c) => c.id),
          );
          const missingCategoryIds = categoryIds.filter(
            (id) => !existingCategoryIds.has(id),
          );
          if (missingCategoryIds.length > 0) {
            throw new Error(
              `Categories not found: ${missingCategoryIds.join(', ')}`,
            );
          }
        }

        // masterId 결정 및 필요 시 마스터 자동 생성
        let masterId: string;
        if (createSkuDto.masterId) {
          // UUID 형식 검증
          if (!isValidUUID(createSkuDto.masterId)) {
            throw new Error(
              `Invalid UUID format for masterId: ${createSkuDto.masterId}`,
            );
          }
          // masterId 존재 확인
          const [existingMaster] = await trx
            .select({ id: wmsTables.inventoryProductMasters.id })
            .from(wmsTables.inventoryProductMasters)
            .where(
              eq(wmsTables.inventoryProductMasters.id, createSkuDto.masterId),
            )
            .limit(1);
          if (!existingMaster) {
            throw new Error(`Master not found: ${createSkuDto.masterId}`);
          }
          masterId = createSkuDto.masterId;
          this.logger.log(
            `[createSku] 기존 마스터 사용 - masterId: ${masterId}`,
          );
        } else {
          const nameForMaster = createSkuDto.masterName ?? createSkuDto.name;
          const masterCode = `M-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
          this.logger.log(
            `[createSku] 새 마스터 생성 시작 - name: ${nameForMaster}, masterCode: ${masterCode}`,
          );
          const [createdMaster] = await trx
            .insert(wmsTables.inventoryProductMasters)
            .values({
              name: nameForMaster,
              masterCode,
              status: 'active' as any,
            })
            .returning();
          masterId = createdMaster.id;
          this.logger.log(
            `[createSku] 새 마스터 생성 완료 - masterId: ${masterId}`,
          );
        }

        this.logger.log(
          `[createSku] SKU 내부 생성 시작 - masterId: ${masterId}`,
        );
        const newSku = await this._createSkuInternal(
          {
            ...createSkuDto,
            masterId,
          } as any,
          trx,
        );
        this.logger.log(`[createSku] SKU 내부 생성 완료 - skuId: ${newSku.id}`);

        if (supplierIds && supplierIds.length > 0) {
          this.logger.log(
            `[createSku] 공급사 연결 시작 - count: ${supplierIds.length}`,
          );
          await trx.insert(wmsTables.skuSuppliers).values(
            supplierIds.map((supplierId) => ({
              skuId: newSku.id,
              supplierId,
            })),
          );
          this.logger.log(`[createSku] 공급사 연결 완료`);
        }

        if (categoryIds && categoryIds.length > 0) {
          this.logger.log(
            `[createSku] 카테고리 연결 시작 - count: ${categoryIds.length}`,
          );
          await trx.insert(wmsTables.skuCategories).values(
            categoryIds.map((categoryId) => ({
              skuId: newSku.id,
              categoryId,
            })),
          );
          this.logger.log(`[createSku] 카테고리 연결 완료`);
        }

        // getSkuById 호출 제거 - 성능 최적화
        // 대신 기본 정보만 반환
        this.logger.log(`[createSku] SKU 생성 완료 - skuId: ${newSku.id}`);
        return {
          id: newSku.id,
          name: newSku.name,
          code: newSku.code,
          defaultBarcode: newSku.defaultBarcode ?? undefined,
          deliveryProfileId: newSku.deliveryProfileId ?? undefined,
          sale1m: newSku.sale1m ?? undefined,
          sale3m: newSku.sale3m ?? undefined,
          safetyStock: newSku.safetyStock,
          masterId: newSku.masterId,
          optionKey: (newSku.optionKey as any) ?? undefined,
          master: {
            id: newSku.masterId,
            name: 'Loading...', // 나중에 필요하면 getSkuById로 조회
            code: '',
            hasOptions: false,
          },
          barcodes: newSku.defaultBarcode
            ? [
                {
                  id: '',
                  barcode: newSku.defaultBarcode,
                  barcodeType: 'standard',
                  packingUnit: undefined,
                },
              ]
            : [],
          supplierNames: [],
          categoryNames: [],
          createdAt: newSku.createdAt,
          updatedAt: newSku.updatedAt,
        };
      } catch (error) {
        this.logger.error(
          `[createSku] 에러 발생: ${error.message}`,
          error.stack,
        );
        throw error;
      }
    }, tx);
  }

  async updateSku(
    skuId: string,
    updateSkuDto: UpdateSkuDto,
    tx?: DbTx,
  ): Promise<SkuResponseDto> {
    return this.inTx(async (trx) => {
      const { supplierIds, categoryIds, ...updateData } = updateSkuDto;

      await this._updateSkuInternal(skuId, updateData, trx);

      if (supplierIds !== undefined) {
        await trx
          .delete(wmsTables.skuSuppliers)
          .where(eq(wmsTables.skuSuppliers.skuId, skuId));

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
        await trx
          .delete(wmsTables.skuCategories)
          .where(eq(wmsTables.skuCategories.skuId, skuId));

        if (categoryIds.length > 0) {
          await trx.insert(wmsTables.skuCategories).values(
            categoryIds.map((categoryId) => ({
              skuId,
              categoryId,
            })),
          );
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
      const [stockAgg] = await this.inTx(
        async (trx) =>
          trx
            .select({
              qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}),0)`,
            })
            .from(wmsTables.stockLedgers)
            .where(eq(wmsTables.stockLedgers.skuId, skuId)),
        tx,
      );

      const totalStock = stockAgg?.qty ?? 0;
      if (totalStock > 0) {
        throw new ConflictException(
          `Cannot delete SKU ${skuId}: Has active stock of ${totalStock} units. ` +
            'Please adjust stock to zero before deletion.',
        );
      }

      // 3. 상품 매칭 사용 확인
      const matchings = await this.inTx(
        async (trx) =>
          trx
            .select({
              productMatchingId:
                wmsTables.productVariantSkuLinks.productMatchingId,
            })
            .from(wmsTables.productVariantSkuLinks)
            .where(eq(wmsTables.productVariantSkuLinks.skuId, skuId)),
        tx,
      );

      if (matchings.length > 0) {
        const matchingIds = matchings
          .map((m) => m.productMatchingId)
          .join(', ');
        throw new ConflictException(
          `Cannot delete SKU ${skuId}: Used in ${matchings.length} product matching(s): ${matchingIds}. ` +
            'Please remove from product matchings first.',
        );
      }

      // 4. 예약 확인
      const reservations = await this.inTx(
        async (trx) =>
          trx
            .select({ id: wmsTables.stockReservations.id })
            .from(wmsTables.stockReservations)
            .where(
              and(
                eq(wmsTables.stockReservations.skuId, skuId),
                eq(wmsTables.stockReservations.status, 'confirmed'),
              ),
            ),
        tx,
      );

      if (reservations.length > 0) {
        throw new ConflictException(
          `Cannot delete SKU ${skuId}: Has ${reservations.length} active reservation(s). ` +
            'Please release all reservations first.',
        );
      }

      // 5. 삭제 실행
      const deleteResult = await this.inTx(
        async (trx) =>
          trx
            .delete(wmsTables.skus)
            .where(eq(wmsTables.skus.id, skuId))
            .returning(),
        tx,
      );

      if (deleteResult.length === 0) {
        throw new ConflictException(
          `Failed to delete SKU ${skuId}. It may have been deleted by another process.`,
        );
      }

      this.logger.log(`SKU ${skuId} (${sku.name}) deleted successfully`);
    } catch (error) {
      this.logger.error(`Failed to delete SKU ${skuId}:`, error);
      throw error;
    }
  }

  async getSkuById(skuId: string, tx?: DbTx): Promise<SkuResponseDto> {
    this.logger.debug(`[getSkuById] 시작 - skuId: ${skuId}, tx 제공: ${!!tx}`);
    return this.inTx(async (trx) => {
      try {
        this.logger.debug(`[getSkuById] SKU 조회 시작`);
        const [row] = await trx
          .select({
            id: wmsTables.skus.id,
            name: wmsTables.skus.name,
            code: wmsTables.skus.code,
            defaultBarcode: wmsTables.skus.defaultBarcode,
            deliveryProfileId: wmsTables.skus.deliveryProfileId,
            sale1m: wmsTables.skus.sale1m,
            sale3m: wmsTables.skus.sale3m,
            safetyStock: wmsTables.skus.safetyStock,
            masterId: wmsTables.skus.masterId,
            optionKey: wmsTables.skus.optionKey,
            masterName: wmsTables.inventoryProductMasters.name,
            masterCode: wmsTables.inventoryProductMasters.masterCode,
            masterOptionSchema: wmsTables.inventoryProductMasters.optionSchema,
            createdAt: wmsTables.skus.createdAt,
            updatedAt: wmsTables.skus.updatedAt,
          })
          .from(wmsTables.skus)
          .innerJoin(
            wmsTables.inventoryProductMasters,
            eq(wmsTables.skus.masterId, wmsTables.inventoryProductMasters.id),
          )
          .where(eq(wmsTables.skus.id, skuId))
          .limit(1);
        this.logger.debug(`[getSkuById] SKU 조회 완료 - found: ${!!row}`);

        if (!row) {
          throw new NotFoundException(`SKU with ID ${skuId} not found`);
        }

        this.logger.debug(
          `[getSkuById] 관련 데이터 조회 시작 (바코드, 공급사, 카테고리)`,
        );
        const [barcodes, suppliers, categories] = await Promise.all([
          trx
            .select()
            .from(wmsTables.skuBarcodes)
            .where(eq(wmsTables.skuBarcodes.skuId, skuId)),
          trx
            .select({
              name: wmsTables.suppliers.name,
            })
            .from(wmsTables.skuSuppliers)
            .innerJoin(
              wmsTables.suppliers,
              eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id),
            )
            .where(eq(wmsTables.skuSuppliers.skuId, skuId)),
          trx
            .select({
              name: wmsTables.categories.name,
            })
            .from(wmsTables.skuCategories)
            .innerJoin(
              wmsTables.categories,
              eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id),
            )
            .where(eq(wmsTables.skuCategories.skuId, skuId)),
        ]);
        this.logger.debug(
          `[getSkuById] 관련 데이터 조회 완료 - 바코드: ${barcodes.length}, 공급사: ${suppliers.length}, 카테고리: ${categories.length}`,
        );

        this.logger.debug(`[getSkuById] 응답 객체 생성 시작`);
        const result = {
          id: row.id,
          name: row.name,
          code: row.code,
          defaultBarcode: row.defaultBarcode ?? undefined,
          deliveryProfileId: row.deliveryProfileId ?? undefined,
          sale1m: row.sale1m ?? undefined,
          sale3m: row.sale3m ?? undefined,
          safetyStock: row.safetyStock,
          masterId: row.masterId,
          optionKey: (row.optionKey as any) ?? undefined,
          master: {
            id: row.masterId,
            name: row.masterName,
            code: row.masterCode,
            hasOptions: !!row.masterOptionSchema,
          },
          barcodes: barcodes.map((b) => ({
            id: b.id,
            barcode: b.barcode,
            barcodeType: b.barcodeType,
            packingUnit: b.packingUnit ?? undefined,
          })),
          supplierNames: suppliers.map((s) => s.name),
          categoryNames: categories.map((c) => c.name),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
        this.logger.debug(`[getSkuById] 응답 객체 생성 완료`);
        return result;
      } catch (error) {
        this.logger.error(
          `[getSkuById] 에러 발생: ${error.message}`,
          error.stack,
        );
        throw error;
      }
    }, tx);
  }

  async searchSkus(
    query: {
      id?: string;
      code?: string;
      barcode?: string;
      name?: string;
      supplierName?: string;
      inventoryManagement?: boolean;
      masterId?: string;
    },
    tx?: DbTx,
  ): Promise<SkuResponseDto[]> {
    const results = await this.inTx(async (trx) => {
      const baseQuery = trx
        .select({
          sku: wmsTables.skus,
          barcode: wmsTables.skuBarcodes,
          supplier: wmsTables.suppliers,
          category: wmsTables.categories,
        })
        .from(wmsTables.skus)
        .leftJoin(
          wmsTables.skuBarcodes,
          eq(wmsTables.skus.id, wmsTables.skuBarcodes.skuId),
        )
        .leftJoin(
          wmsTables.skuSuppliers,
          eq(wmsTables.skus.id, wmsTables.skuSuppliers.skuId),
        )
        .leftJoin(
          wmsTables.suppliers,
          eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id),
        )
        .leftJoin(
          wmsTables.skuCategories,
          eq(wmsTables.skus.id, wmsTables.skuCategories.skuId),
        )
        .leftJoin(
          wmsTables.categories,
          eq(wmsTables.skuCategories.categoryId, wmsTables.categories.id),
        );

      const conditions: any[] = [];

      if (query.id) conditions.push(eq(wmsTables.skus.id, query.id));
      if (query.code) conditions.push(eq(wmsTables.skus.code, query.code));
      if (query.masterId)
        conditions.push(eq(wmsTables.skus.masterId, query.masterId));
      if (query.name)
        conditions.push(
          sql`${wmsTables.skus.name} ILIKE ${'%' + query.name + '%'}`,
        );

      if (query.barcode) {
        const barcodeCondition = or(
          eq(wmsTables.skus.defaultBarcode, query.barcode),
          eq(wmsTables.skuBarcodes.barcode, query.barcode),
        );
        if (barcodeCondition) conditions.push(barcodeCondition);
      }

      if (query.supplierName) {
        conditions.push(
          sql`${wmsTables.suppliers.name} ILIKE ${'%' + query.supplierName + '%'}`,
        );
      }

      const finalQuery =
        conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
      return finalQuery;
    }, tx);

    const aggregatedSkus = results.reduce(
      (acc, row) => {
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
      },
      {} as Record<string, any>,
    );

    return Object.values(aggregatedSkus).map((sku) => ({
      id: sku.id,
      name: sku.name,
      code: sku.code,
      defaultBarcode: sku.defaultBarcode,
      deliveryProfileId: sku.deliveryProfileId,
      sale1m: sku.sale1m,
      sale3m: sku.sale3m,
      safetyStock: sku.safetyStock ?? 0,
      masterId: sku.masterId,
      optionKey: sku.optionKey,
      barcodes: Array.from(sku.barcodes.values()),
      supplierNames: Array.from(sku.supplierNames),
      categoryNames: Array.from(sku.categoryNames),
      createdAt: sku.createdAt,
      updatedAt: sku.updatedAt,
    }));
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
      // Build where conditions
      const conditions: SQL[] = [];

      // Search by name or code
      if (filters.search) {
        conditions.push(
          or(
            like(wmsTables.skus.name, `%${filters.search}%`),
            like(wmsTables.skus.code, `%${filters.search}%`),
          )!,
        );
      }

      // Barcode search
      if (filters.barcode) {
        conditions.push(eq(wmsTables.skus.defaultBarcode, filters.barcode));
      }

      // Stock type
      if (filters.stockType) {
        conditions.push(eq(wmsTables.skus.stockType, filters.stockType as any));
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
            ? isNotNull(wmsTables.skus.groupId) // Has group
            : isNull(wmsTables.skus.groupId), // Standalone SKU
        );
      }

      // Inventory Master filter (WMS-internal)
      if (filters.inventoryMasterId) {
        conditions.push(eq(wmsTables.skus.masterId, filters.inventoryMasterId));
      }

      // Location filter
      if (filters.locationId) {
        conditions.push(
          eq(wmsTables.skus.primaryLocationId, filters.locationId),
        );
      }

      // Date range
      if (filters.startDate) {
        conditions.push(
          gte(wmsTables.skus.createdAt, new Date(filters.startDate)),
        );
      }
      if (filters.endDate) {
        conditions.push(
          lte(wmsTables.skus.createdAt, new Date(filters.endDate)),
        );
      }

      // Build base query with stock summary join (for filtering only)
      let query = trx
        .select({
          sku: wmsTables.skus,
        })
        .from(wmsTables.skus)
        .leftJoin(
          wmsSchema.stockSummary,
          eq(wmsTables.skus.id, wmsSchema.stockSummary.skuId),
        );

      // Apply base conditions
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      // Display mode filters (applied to joined stockSummary)
      if (filters.displayMode) {
        switch (filters.displayMode) {
          case StockDisplayMode.BELOW_SAFETY:
            query = query.where(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) < ${wmsTables.skus.safetyStock}`,
            ) as any;
            break;
          case StockDisplayMode.WITH_STOCK:
            query = query.where(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) > 0`,
            ) as any;
            break;
          case StockDisplayMode.OUT_OF_STOCK:
            query = query.where(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) = 0`,
            ) as any;
            break;
        }
      }

      // Warehouse filter (via stock summary)
      if (filters.warehouseId) {
        query = query.where(
          eq(wmsSchema.stockSummary.warehouseId, filters.warehouseId),
        ) as any;
      }

      // Sorting
      const sortField = filters.sortBy ?? 'createdAt';
      const sortDirection = filters.sortOrder ?? 'desc';

      if (sortDirection === 'asc') {
        query = query.orderBy(asc(wmsTables.skus[sortField])) as any;
      } else {
        query = query.orderBy(sql`${wmsTables.skus[sortField]} DESC`) as any;
      }

      // Pagination
      query = query
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0) as any;

      // Execute query
      const results = await query;

      // Count total (with same conditions)
      let countQuery = trx
        .select({ count: sql<number>`count(DISTINCT ${wmsTables.skus.id})` })
        .from(wmsTables.skus)
        .leftJoin(
          wmsSchema.stockSummary,
          eq(wmsTables.skus.id, wmsSchema.stockSummary.skuId),
        );

      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions)) as any;
      }

      // Apply display mode to count query
      if (filters.displayMode) {
        switch (filters.displayMode) {
          case StockDisplayMode.BELOW_SAFETY:
            countQuery = countQuery.where(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) < ${wmsTables.skus.safetyStock}`,
            ) as any;
            break;
          case StockDisplayMode.WITH_STOCK:
            countQuery = countQuery.where(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) > 0`,
            ) as any;
            break;
          case StockDisplayMode.OUT_OF_STOCK:
            countQuery = countQuery.where(
              sql`COALESCE(${wmsSchema.stockSummary.onHandQty}, 0) = 0`,
            ) as any;
            break;
        }
      }

      if (filters.warehouseId) {
        countQuery = countQuery.where(
          eq(wmsSchema.stockSummary.warehouseId, filters.warehouseId),
        ) as any;
      }

      const [countResult] = await countQuery;
      const total = Number(countResult?.count ?? 0);

      // Map to DTOs
      const uniqueSkuIds = [...new Set(results.map((row) => row.sku.id))];

      // 모든 SKU의 재고 정보를 한 번에 조회
      const stockInfoMap = new Map<string, number>();
      if (uniqueSkuIds.length > 0) {
        // 조건 배열 구성
        const stockConditions: SQL[] = [
          inArray(wmsSchema.stockSummary.skuId, uniqueSkuIds),
        ];

        // 창고 필터가 있으면 조건에 추가
        if (filters.warehouseId) {
          stockConditions.push(
            eq(wmsSchema.stockSummary.warehouseId, filters.warehouseId),
          );
        }

        const stockSummaries = await trx
          .select({
            skuId: wmsSchema.stockSummary.skuId,
            totalOnHand: sql<number>`COALESCE(SUM(${wmsSchema.stockSummary.onHandQty}), 0)`,
          })
          .from(wmsSchema.stockSummary)
          .where(and(...stockConditions))
          .groupBy(wmsSchema.stockSummary.skuId);

        stockSummaries.forEach((summary) => {
          stockInfoMap.set(summary.skuId, summary.totalOnHand);
        });
      }

      const items = await Promise.all(
        uniqueSkuIds.map(async (skuId) => {
          const sku = await this.getSkuById(skuId, trx);
          return {
            ...sku,
            currentStock: stockInfoMap.get(skuId) ?? 0,
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

  async addBarcode(
    skuId: string,
    addBarcodeDto: AddBarcodeDto,
    tx?: DbTx,
  ): Promise<void> {
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
      throw new ConflictException(
        `Barcode ${addBarcodeDto.barcode} already exists`,
      );
    }

    await this.inTx(
      async (trx) =>
        trx.insert(wmsTables.skuBarcodes).values({
          skuId,
          barcode: addBarcodeDto.barcode,
          barcodeType: addBarcodeDto.barcodeType || 'standard',
          packingUnit: addBarcodeDto.packingUnit,
        }),
      tx,
    );

    this.logger.log(`Barcode ${addBarcodeDto.barcode} added to SKU ${skuId}`);
  }

  async removeBarcode(
    skuId: string,
    barcodeId: string,
    tx?: DbTx,
  ): Promise<void> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const barcode = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(
          and(
            eq(wmsTables.skuBarcodes.id, barcodeId),
            eq(wmsTables.skuBarcodes.skuId, skuId),
          ),
        )
        .limit(1);
      return row;
    }, tx);

    if (!barcode) {
      throw new NotFoundException(
        `Barcode with ID ${barcodeId} not found for SKU ${skuId}`,
      );
    }

    if (sku.defaultBarcode === barcode.barcode) {
      throw new BadRequestException('Cannot remove default barcode');
    }

    await this.inTx(
      async (trx) =>
        trx
          .delete(wmsTables.skuBarcodes)
          .where(eq(wmsTables.skuBarcodes.id, barcodeId)),
      tx,
    );

    this.logger.log(`Barcode ${barcodeId} removed from SKU ${skuId}`);
  }

  // ****************************************************************
  // 재고 관리 도메인
  // ****************************************************************

  async getCurrentStock(query: GetStockQueryDto, tx?: DbTx) {
    const { skuId, warehouseId, locationId, asOfTimestamp } = query;
    if (asOfTimestamp) {
      throw new BadRequestException(
        'asOfTimestamp 기반 조회는 아직 지원되지 않습니다.',
      );
    }

    const rows = await this.inTx(
      async (trx) =>
        trx
          .select({
            skuId: wmsTables.stockLedgers.skuId,
            warehouseId: wmsTables.stockLedgers.warehouseId,
            locationId: wmsTables.stockLedgers.locationId,
            stockState: wmsTables.stockLedgers.stockState,
            quantity: wmsTables.stockLedgers.qty,
          })
          .from(wmsTables.stockLedgers)
          .where(
            and(
              skuId ? eq(wmsTables.stockLedgers.skuId, skuId) : undefined,
              warehouseId
                ? eq(wmsTables.stockLedgers.warehouseId, warehouseId)
                : undefined,
              locationId
                ? eq(wmsTables.stockLedgers.locationId, locationId)
                : undefined,
            ),
          ),
      tx,
    );

    return rows;
  }

  async getTotalStockBySku(
    skuId: string,
    tx?: DbTx,
  ): Promise<{
    skuId: string;
    totalRealQuantity: number;
    totalReservedQuantity: number;
    totalAvailableQuantity: number;
  }> {
    const summaries = await this.inTx(
      async (trx) =>
        trx
          .select()
          .from(wmsSchema.stockSummary)
          .where(eq(wmsSchema.stockSummary.skuId, skuId)),
      tx,
    );

    const total = summaries.reduce(
      (acc, summary) => ({
        totalRealQuantity:
          acc.totalRealQuantity +
          summary.onHandQty +
          summary.defectiveQty +
          summary.inTransferQty,
        totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQty,
        totalAvailableQuantity:
          acc.totalAvailableQuantity + summary.availableQty,
      }),
      {
        totalRealQuantity: 0,
        totalReservedQuantity: 0,
        totalAvailableQuantity: 0,
      },
    );

    return {
      skuId,
      totalRealQuantity: total.totalRealQuantity,
      totalReservedQuantity: total.totalReservedQuantity,
      totalAvailableQuantity: total.totalAvailableQuantity,
    };
  }

  async getStockBySkuAndWarehouse(
    skuId: string,
    warehouseId: string,
    tx?: DbTx,
  ) {
    const summary = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsSchema.stockSummary)
        .where(
          and(
            eq(wmsSchema.stockSummary.skuId, skuId),
            eq(wmsSchema.stockSummary.warehouseId, warehouseId),
          ),
        )
        .limit(1);
      return row;
    }, tx);

    const details = await this.inTx(
      async (trx) =>
        trx
          .select({
            locationId: wmsTables.stockLedgers.locationId,
            stockState: wmsTables.stockLedgers.stockState,
            quantity: wmsTables.stockLedgers.qty,
          })
          .from(wmsTables.stockLedgers)
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, skuId),
              eq(wmsTables.stockLedgers.warehouseId, warehouseId),
            ),
          ),
      tx,
    );

    return {
      summary: summary
        ? {
            currentQuantity:
              summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
            availableQuantity: summary.availableQty,
            reservedQuantity: summary.reservedQty,
            inboundPendingQuantity: summary.inboundPendingQty,
            outboundPendingQuantity: summary.onOrderQty,
            movingQuantity: summary.inTransferQty,
            defectiveQuantity: summary.defectiveQty,
            returnPendingQuantity: summary.transferPendingQty,
            lastUpdated: summary.lastCalculatedAt,
          }
        : null,
      details,
    };
  }

  async getStockHistory(
    skuId: string,
    warehouseId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    return this.eventStore.getEventHistory(
      skuId,
      warehouseId,
      startDate,
      endDate,
    );
  }

  async getQuickStockSummary(skuId?: string, warehouseId?: string, tx?: DbTx) {
    const conditions: any[] = [];
    if (skuId) conditions.push(eq(wmsSchema.stockSummary.skuId, skuId));
    if (warehouseId)
      conditions.push(eq(wmsSchema.stockSummary.warehouseId, warehouseId));

    const summaries = await this.inTx(
      async (trx) =>
        trx
          .select()
          .from(wmsSchema.stockSummary)
          .where(
            conditions.length > 0
              ? and(...(conditions as [any, ...any[]]))
              : undefined,
          ),
      tx,
    );

    return summaries;
  }

  async adjustStockManually(stockId: string, delta: number, reason: string) {
    throw new BadRequestException(
      'stockId 기반 수동 조정은 더 이상 지원하지 않습니다.',
    );
  }

  async getSkuStockSummary(
    skuId: string,
    tx?: DbTx,
  ): Promise<SkuStockSummaryDto> {
    const sku = await this.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found`);
    }

    const summaries = await this.inTx(
      async (trx) =>
        trx
          .select()
          .from(wmsSchema.stockSummary)
          .where(eq(wmsSchema.stockSummary.skuId, skuId)),
      tx,
    );

    const warehouseIds = summaries.map((summary) => summary.warehouseId);
    const warehouses = await this.inTx(
      async (trx) =>
        trx
          .select()
          .from(wmsTables.warehouses)
          .where(sql`${wmsTables.warehouses.id} = ANY(${warehouseIds})`),
      tx,
    );

    const warehouseMap = new Map(
      warehouses.map((warehouse) => [warehouse.id, warehouse]),
    );

    const warehouseStocks = summaries.map((summary) => ({
      warehouseId: summary.warehouseId,
      warehouseName:
        warehouseMap.get(summary.warehouseId)?.name || 'Unknown Warehouse',
      realQuantity:
        summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
      reservedQuantity: summary.reservedQty,
      availableQuantity: summary.availableQty,
    }));

    const totals = summaries.reduce(
      (acc, summary) => ({
        totalRealQuantity:
          acc.totalRealQuantity +
          summary.onHandQty +
          summary.defectiveQty +
          summary.inTransferQty,
        totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQty,
        totalAvailableQuantity:
          acc.totalAvailableQuantity + summary.availableQty,
      }),
      {
        totalRealQuantity: 0,
        totalReservedQuantity: 0,
        totalAvailableQuantity: 0,
      },
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
    throw new BadRequestException(
      '재고 요약 재구축은 추후 프로젝션 서비스로 제공됩니다.',
    );
  }

  // ****************************************************************
  // 창고 관리 도메인
  // ****************************************************************

  async createWarehouse(createWarehouseDto: CreateWarehouseDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const [newWarehouse] = await trx
        .insert(wmsTables.warehouses)
        .values({
          name: createWarehouseDto.name,
          type: createWarehouseDto.type || 'domestic',
          location: createWarehouseDto.location,
        })
        .returning();

      this.logger.log(
        `새 창고 생성: ${newWarehouse.name} (ID: ${newWarehouse.id})`,
      );
      // 창고 생성 직후 시스템 로케이션 보장 (동일 트랜잭션)
      await this.locationService.ensureSystemLocations(newWarehouse.id, trx);
      return newWarehouse;
    }, tx);
  }

  async findAllWarehouses(tx?: DbTx) {
    return this.inTx(
      async (trx) =>
        trx
          .select()
          .from(wmsTables.warehouses)
          .orderBy(asc(wmsTables.warehouses.name)),
      tx,
    );
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

  async updateWarehouse(
    id: string,
    updateWarehouseDto: UpdateWarehouseDto,
    tx?: DbTx,
  ) {
    const [updatedWarehouse] = await this.inTx(
      async (trx) =>
        trx
          .update(wmsTables.warehouses)
          .set({
            ...updateWarehouseDto,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.warehouses.id, id))
          .returning(),
      tx,
    ).then((r) => r);

    if (!updatedWarehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    this.logger.log(`창고 정보 업데이트: ${updatedWarehouse.name}`);
    return updatedWarehouse;
  }

  async removeWarehouse(id: string, tx?: DbTx) {
    if (
      id === WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id ||
      id === WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id
    ) {
      throw new Error('기본 창고는 삭제할 수 없습니다.');
    }

    const inUse = await this._isWarehouseInUse(id);
    if (inUse) {
      throw new Error('사용 중인 창고는 삭제할 수 없습니다.');
    }

    const [deletedWarehouse] = await this.inTx(
      async (trx) =>
        trx
          .delete(wmsTables.warehouses)
          .where(eq(wmsTables.warehouses.id, id))
          .returning(),
      tx,
    ).then((r) => r);

    if (!deletedWarehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    return deletedWarehouse;
  }

  async getWarehouseStockSummary(warehouseId: string) {
    const rows = await this.db
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        skuName: wmsTables.skus.name,
        skuCode: wmsTables.skus.code,
        totalQuantity: sql<number>`sum(${wmsTables.stockLedgers.qty})`,
        locationCount: sql<number>`count(distinct ${wmsTables.stockLedgers.locationId})`,
      })
      .from(wmsTables.stockLedgers)
      .innerJoin(
        wmsTables.skus,
        eq(wmsTables.stockLedgers.skuId, wmsTables.skus.id),
      )
      .where(eq(wmsTables.stockLedgers.warehouseId, warehouseId))
      .groupBy(
        wmsTables.stockLedgers.skuId,
        wmsTables.skus.name,
        wmsTables.skus.code,
      );

    return {
      warehouseId,
      summary: rows,
      totalSkus: rows.length,
      totalQuantity: rows.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalAvailable: rows.reduce((sum, item) => sum + item.totalQuantity, 0),
    };
  }

  // ****************************************************************
  // Helper Methods
  // ****************************************************************

  async _createSkuInternal(
    data: Omit<
      CreateSkuDto,
      'id' | 'code' | 'defaultBarcode' | 'supplierIds' | 'categoryIds'
    > & { masterId: string },
    tx: DbTx,
  ) {
    this.logger.debug(
      `[_createSkuInternal] 시작 - masterId: ${data.masterId}, name: ${data.name}`,
    );
    const db = tx;

    // 기본 holder 확인 및 생성 (트랜잭션 내에서)
    const DEFAULT_HOLDER_ID = '00000000-0000-0000-0000-000000000000';
    const [existingHolder] = await db
      .select()
      .from(wmsTables.holders)
      .where(eq(wmsTables.holders.id, DEFAULT_HOLDER_ID))
      .limit(1);

    if (!existingHolder) {
      this.logger.debug(`[_createSkuInternal] 기본 Holder 생성 시작`);
      await db.insert(wmsTables.holders).values({
        id: DEFAULT_HOLDER_ID,
        name: 'Default Holder',
        isOurAsset: true,
      });
      this.logger.debug(`[_createSkuInternal] 기본 Holder 생성 완료`);
    }

    // preStockSellable 제거
    const skuCode = this._generateSkuCode();
    this.logger.debug(`[_createSkuInternal] SKU 코드 생성 - code: ${skuCode}`);

    let skuName: string;
    if (data.source === SkuCreationSource.AUTO_MATCHING) {
      skuName = `${data.productName || 'Unknown Product'} - ${data.variantName || 'Unknown Variant'}`;
    } else if (data.source === SkuCreationSource.MANUAL_MATCHING) {
      skuName = data.name;
    } else {
      skuName = data.name || `Auto-generated SKU Name (${skuCode})`;
    }
    this.logger.debug(`[_createSkuInternal] SKU 이름 결정 - name: ${skuName}`);

    this.logger.debug(`[_createSkuInternal] SKU INSERT 시작`);
    const [newSku] = await db
      .insert(wmsTables.skus)
      .values({
        masterId: data.masterId,
        name: skuName,
        code: skuCode,
        optionKey: data.optionKey ?? null,
        deliveryProfileId: data.deliveryProfileId,
        sale1m: data.sale1m,
        sale3m: data.sale3m,
        safetyStock: data.safetyStock ?? 0,
        // Extended Metadata Fields
        businessProductName: data.businessProductName,
        importDeclarationNumber: data.importDeclarationNumber,
        logisticsPartnerId: data.logisticsPartnerId,
        discount: data.discount,
        manufacturerStar: data.manufacturerStar,
        // 물리 속성
        productWeight: data.productWeight,
        dimensionWidth: data.dimensionWidth,
        dimensionHeight: data.dimensionHeight,
        dimensionDepth: data.dimensionDepth,
        productMaterial: data.productMaterial,
        // 추가 메타데이터
        koreanName: data.koreanName,
        maxDiscountQuantity: data.maxDiscountQuantity,
        packagingImporterName: data.packagingImporterName,
        // 판매 정보
        productDescription: data.productDescription,
        moq: data.moq,
        memo2: data.memo2,
        memo3: data.memo3,
        // 이미지 관리
        mainImageUrl: data.mainImageUrl,
        currentStock: data.currentStock,
        // 유효기간 및 날짜 관리
        expiryDateManagement: data.expiryDateManagement ?? false,
        expiryStartDate: data.expiryStartDate,
        expiryEndDate: data.expiryEndDate,
        manufacturingDateManagement: data.manufacturingDateManagement ?? false,
        isGeneralInventory: data.isGeneralInventory ?? true,
        // 유효 기간
        validityStartDate: data.validityStartDate,
        validityEndDate: data.validityEndDate,
        // 로케이션 추적
        primaryLocationId: data.primaryLocationId,
        secondaryLocationId: data.secondaryLocationId,
        // 옵션 그룹
        variantGroupCode: data.variantGroupCode,
      })
      .returning();
    this.logger.debug(
      `[_createSkuInternal] SKU INSERT 완료 - skuId: ${newSku?.id}`,
    );

    if (!newSku) {
      throw new Error('Failed to create SKU internally');
    }

    this.logger.debug(`[_createSkuInternal] 바코드 생성 시작`);
    const generatedBarcode = await this._generateAndSetDefaultBarcode(
      newSku.id,
      db,
    );
    newSku.defaultBarcode = generatedBarcode;
    this.logger.debug(
      `[_createSkuInternal] 바코드 생성 완료 - barcode: ${generatedBarcode}`,
    );

    this.logger.log(
      `SKU created internally: ${newSku.id} (Name: ${newSku.name}, OptionKey: ${newSku.optionKey || 'N/A'})`,
    );
    return newSku;
  }

  async _updateSkuInternal(
    skuId: string,
    data: Partial<Omit<UpdateSkuDto, 'code' | 'defaultBarcode'>>,
    tx: DbTx,
  ) {
    const db = tx;
    const updateData: Partial<typeof wmsTables.skus.$inferInsert> = {
      name: data.name,
      deliveryProfileId: data.deliveryProfileId,
      sale1m: data.sale1m,
      sale3m: data.sale3m,
      safetyStock: data.safetyStock,
      updatedAt: new Date(),
    };

    const [updatedSku] = await db
      .update(wmsTables.skus)
      .set(updateData)
      .where(eq(wmsTables.skus.id, skuId))
      .returning();

    if (!updatedSku) {
      throw new NotFoundException(
        `SKU with ID ${skuId} not found for internal update`,
      );
    }
    this.logger.log(`SKU updated internally: ${updatedSku.id}`);
    return updatedSku;
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
    const numericPart = String(Math.floor(Math.random() * 100000)).padStart(
      5,
      '0',
    );
    const alphaPart = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26)),
    ).join('');
    return `${prefix}${numericPart}${alphaPart}`;
  }

  private async _generateAndSetDefaultBarcode(
    skuId: string,
    db: DbTx,
  ): Promise<string> {
    this.logger.debug(`[_generateAndSetDefaultBarcode] 시작 - skuId: ${skuId}`);
    const generatedBarcode = `SKU_B_${skuId.substring(0, 8).toUpperCase()}_${Date.now()}`;
    this.logger.debug(
      `[_generateAndSetDefaultBarcode] 바코드 생성 - barcode: ${generatedBarcode}`,
    );

    this.logger.debug(`[_generateAndSetDefaultBarcode] 바코드 INSERT 시작`);
    const [newSkuBarcode] = await db
      .insert(wmsTables.skuBarcodes)
      .values({
        skuId,
        barcode: generatedBarcode,
        barcodeType: 'standard',
      })
      .returning();
    this.logger.debug(`[_generateAndSetDefaultBarcode] 바코드 INSERT 완료`);

    if (!newSkuBarcode) {
      throw new Error('Failed to create default barcode for SKU.');
    }

    this.logger.debug(`[_generateAndSetDefaultBarcode] SKU UPDATE 시작`);
    await db
      .update(wmsTables.skus)
      .set({ defaultBarcode: generatedBarcode, updatedAt: new Date() })
      .where(eq(wmsTables.skus.id, skuId));
    this.logger.debug(`[_generateAndSetDefaultBarcode] SKU UPDATE 완료`);

    this.logger.log(
      `Default barcode ${generatedBarcode} set for SKU ${skuId}.`,
    );
    return generatedBarcode;
  }

  private _calculateAvailableQuantity(
    realQuantity: number,
    reservedQuantity: number,
  ): number {
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
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.warehouseId, warehouseId));

    return (row?.count ?? 0) > 0;
  }

  private async _ensureDefaultHolderExists() {
    try {
      const DEFAULT_HOLDER_ID = '00000000-0000-0000-0000-000000000000';
      const DEFAULT_HOLDER_NAME = 'Default Holder';

      const existingHolder = await this.inTx(async (trx) => {
        const [row] = await trx
          .select()
          .from(wmsTables.holders)
          .where(eq(wmsTables.holders.id, DEFAULT_HOLDER_ID))
          .limit(1);
        return row;
      });

      if (!existingHolder) {
        await this.inTx(async (trx) => {
          await trx.insert(wmsTables.holders).values({
            id: DEFAULT_HOLDER_ID,
            name: DEFAULT_HOLDER_NAME,
            isOurAsset: true,
          });
        });
        this.logger.log(
          `기본 Holder 생성: ${DEFAULT_HOLDER_NAME} (${DEFAULT_HOLDER_ID})`,
        );
      }
    } catch (error) {
      this.logger.error('기본 Holder 생성 중 오류 발생:', error);
    }
  }
}
