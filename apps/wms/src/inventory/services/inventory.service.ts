import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, OnModuleInit } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { GetStockQueryDto } from '../dto/inventory/get-stock-query.dto';
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

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];
type DbOrTx = DbTx | TypedDatabase<typeof wmsTables>;

@Injectable()
export class InventoryService implements OnModuleInit {
    private readonly logger = new Logger(InventoryService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
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
        try {
            const allWarehouses = await this.findAllWarehouses();
            for (const wh of allWarehouses) {
                await this.locationService.ensureSystemLocations(wh.id);
            }
        } catch (e) {
            this.logger.error('시스템 로케이션 프로비저닝 중 오류', e);
        }
    }

    // ****************************************************************
    // SKU 관리 도메인
    // ****************************************************************

    async createSku(createSkuDto: CreateSkuDto, tx?: DbTx): Promise<SkuResponseDto> {
        return this.inTx(async (tx) => {
            const { supplierIds, categoryIds, ...skuData } = createSkuDto;

            const newSku = await this._createSkuInternal(skuData, tx);

            if (supplierIds && supplierIds.length > 0) {
                await tx.insert(wmsTables.skuSuppliers).values(
                    supplierIds.map(supplierId => ({
                        skuId: newSku.id,
                        supplierId,
                    }))
                );
            }

            if (categoryIds && categoryIds.length > 0) {
                await tx.insert(wmsTables.skuCategories).values(
                    categoryIds.map(categoryId => ({
                        skuId: newSku.id,
                        categoryId,
                    }))
                );
            }

            return this.getSkuById(newSku.id, tx);
        }, tx);
    }

    async updateSku(skuId: string, updateSkuDto: UpdateSkuDto): Promise<SkuResponseDto> {
        return this.db.transaction(async (tx) => {
            const { supplierIds, categoryIds, ...updateData } = updateSkuDto;

            await this._updateSkuInternal(skuId, updateData, tx);

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

            return this.getSkuById(skuId, tx);
        });
    }

    async deleteSku(skuId: string): Promise<void> {
        const [agg] = await this.db
            .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}),0)` })
            .from(wmsTables.stockLedgers)
            .where(eq(wmsTables.stockLedgers.skuId, skuId));

        if ((agg?.qty ?? 0) > 0) {
            throw new ConflictException(`Cannot delete SKU ${skuId}: Active stock exists`);
        }

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

    async getSkuById(skuId: string, tx?: DbOrTx): Promise<SkuResponseDto> {
        const db = tx || this.db;
        const sku = await db.query.skus.findFirst({
            where: eq(wmsTables.skus.id, skuId),
        });

        if (!sku) {
            throw new NotFoundException(`SKU with ID ${skuId} not found`);
        }

        const barcodes = await db.query.skuBarcodes.findMany({
            where: eq(wmsTables.skuBarcodes.skuId, skuId),
        });

        const suppliers = await db
            .select({
                name: wmsTables.suppliers.name,
            })
            .from(wmsTables.skuSuppliers)
            .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
            .where(eq(wmsTables.skuSuppliers.skuId, skuId));

        const categories = await db
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

        const conditions: any[] = [];

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

        return Object.values(aggregatedSkus).map(sku => ({
            id: sku.id,
            name: sku.name,
            code: sku.code,
            defaultBarcode: sku.defaultBarcode,
            deliveryProfileId: sku.deliveryProfileId,
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


    // ****************************************************************
    // 재고 관리 도메인
    // ****************************************************************

    async getCurrentStock(query: GetStockQueryDto) {
        const { skuId, warehouseId, locationId, asOfTimestamp } = query;
        if (asOfTimestamp) {
            throw new BadRequestException('asOfTimestamp 기반 조회는 아직 지원되지 않습니다.');
        }

        const rows = await this.db
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
            ));

        return rows;
    }

    async getTotalStockBySku(skuId: string): Promise<{
        skuId: string;
        totalRealQuantity: number;
        totalReservedQuantity: number;
        totalAvailableQuantity: number;
    }> {
        const summaries = await this.db.query.stockSummary.findMany({
            where: eq(wmsTables.stockSummary.skuId, skuId),
        });

        const total = summaries.reduce(
            (acc, summary) => ({
                totalRealQuantity: acc.totalRealQuantity + summary.currentQuantity,
                totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQuantity,
                totalAvailableQuantity: acc.totalAvailableQuantity + summary.availableQuantity,
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

    async getStockBySkuAndWarehouse(skuId: string, warehouseId: string) {
        const summary = await this.db.query.stockSummary.findFirst({
            where: and(
                eq(wmsTables.stockSummary.skuId, skuId),
                eq(wmsTables.stockSummary.warehouseId, warehouseId)
            ),
        });

        const details = await this.db
            .select({
                locationId: wmsTables.stockLedgers.locationId,
                stockState: wmsTables.stockLedgers.stockState,
                quantity: wmsTables.stockLedgers.qty,
            })
            .from(wmsTables.stockLedgers)
            .where(and(
                eq(wmsTables.stockLedgers.skuId, skuId),
                eq(wmsTables.stockLedgers.warehouseId, warehouseId),
            ));

        return {
            summary: summary ? {
                currentQuantity: summary.currentQuantity,
                availableQuantity: summary.availableQuantity,
                reservedQuantity: summary.reservedQuantity,
                inboundPendingQuantity: summary.inboundPendingQuantity,
                outboundPendingQuantity: summary.outboundPendingQuantity,
                movingQuantity: summary.movingQuantity,
                damageQuantity: summary.damageQuantity,
                returnPendingQuantity: summary.returnPendingQuantity,
                lastUpdated: summary.lastUpdated,
            } : null,
            details,
        };
    }

    async getStockHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
        return this.eventStore.getEventHistory(skuId, warehouseId, startDate, endDate);
    }

    async getQuickStockSummary(skuId?: string, warehouseId?: string) {
        const conditions: any[] = [];
        if (skuId) conditions.push(eq(wmsTables.stockSummary.skuId, skuId));
        if (warehouseId) conditions.push(eq(wmsTables.stockSummary.warehouseId, warehouseId));

        const summaries = await this.db.query.stockSummary.findMany({
            where: conditions.length > 0 ? and(...conditions as [any, ...any[]]) : undefined,
            with: {
                sku: true,
                warehouse: true,
            },
        });

        return summaries;
    }

    async adjustStockManually(stockId: string, delta: number, reason: string) {
        throw new BadRequestException('stockId 기반 수동 조정은 더 이상 지원하지 않습니다.');
    }

    async getSkuStockSummary(skuId: string): Promise<SkuStockSummaryDto> {
        const sku = await this.findSkuById(skuId);
        if (!sku) {
            throw new NotFoundException(`SKU with ID ${skuId} not found`);
        }

        const summaries = await this.db.query.stockSummary.findMany({
            where: eq(wmsTables.stockSummary.skuId, skuId),
        });

        const warehouseIds = summaries.map(summary => summary.warehouseId);
        const warehouses = await this.db.query.warehouses.findMany({
            where: sql`${wmsTables.warehouses.id} = ANY(${warehouseIds})`,
        });

        const warehouseMap = new Map(warehouses.map(warehouse => [warehouse.id, warehouse]));

        const warehouseStocks = summaries.map(summary => ({
            warehouseId: summary.warehouseId,
            warehouseName: warehouseMap.get(summary.warehouseId)?.name || 'Unknown Warehouse',
            realQuantity: summary.currentQuantity,
            reservedQuantity: summary.reservedQuantity,
            availableQuantity: summary.availableQuantity,
        }));

        const totals = summaries.reduce(
            (acc, summary) => ({
                totalRealQuantity: acc.totalRealQuantity + summary.currentQuantity,
                totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQuantity,
                totalAvailableQuantity: acc.totalAvailableQuantity + summary.availableQuantity,
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

    async createWarehouse(createWarehouseDto: CreateWarehouseDto) {
        const [newWarehouse] = await this.db.insert(wmsTables.warehouses).values({
            name: createWarehouseDto.name,
            type: createWarehouseDto.type || 'domestic',
            location: createWarehouseDto.location,
        }).returning();

        this.logger.log(`새 창고 생성: ${newWarehouse.name} (ID: ${newWarehouse.id})`);
        // 창고 생성 직후 시스템 로케이션 보장
        await this.locationService.ensureSystemLocations(newWarehouse.id);
        return newWarehouse;
    }

    async findAllWarehouses() {
        return this.db.query.warehouses.findMany({
            orderBy: (warehouses, { asc }) => [asc(warehouses.name)],
        });
    }

    async findOneWarehouse(id: string) {
        const warehouse = await this.db.query.warehouses.findFirst({
            where: eq(wmsTables.warehouses.id, id),
        });

        if (!warehouse) {
            throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
        }

        return warehouse;
    }

    async updateWarehouse(id: string, updateWarehouseDto: UpdateWarehouseDto) {
        const [updatedWarehouse] = await this.db.update(wmsTables.warehouses)
            .set({
                ...updateWarehouseDto,
                updatedAt: new Date(),
            })
            .where(eq(wmsTables.warehouses.id, id))
            .returning();

        if (!updatedWarehouse) {
            throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
        }

        this.logger.log(`창고 정보 업데이트: ${updatedWarehouse.name}`);
        return updatedWarehouse;
    }

    async removeWarehouse(id: string) {
        if (id === WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id ||
            id === WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id) {
            throw new Error('기본 창고는 삭제할 수 없습니다.');
        }

        const inUse = await this._isWarehouseInUse(id);
        if (inUse) {
            throw new Error('사용 중인 창고는 삭제할 수 없습니다.');
        }

        const [deletedWarehouse] = await this.db.delete(wmsTables.warehouses)
            .where(eq(wmsTables.warehouses.id, id))
            .returning();

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

    // ****************************************************************
    // Helper Methods
    // ****************************************************************

    async _createSkuInternal(data: Omit<CreateSkuDto, 'id' | 'code' | 'defaultBarcode' | 'supplierIds' | 'categoryIds'>, tx?: DbOrTx) {
        const db = tx || this.db;
        // preStockSellable 제거
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
            sale1m: data.sale1m,
            sale3m: data.sale3m,
        }).returning();

        if (!newSku) {
            throw new Error('Failed to create SKU internally');
        }

        const generatedBarcode = await this._generateAndSetDefaultBarcode(newSku.id, db);
        newSku.defaultBarcode = generatedBarcode;

        this.logger.log(`SKU created internally: ${newSku.id} (Name: ${newSku.name})`);
        return newSku;
    }

    async _updateSkuInternal(skuId: string, data: Partial<Omit<UpdateSkuDto, 'code' | 'defaultBarcode'>>, tx?: DbTx) {
        const db = tx || this.db;
        const updateData: Partial<typeof wmsTables.skus.$inferInsert> = {
            name: data.name,
            deliveryProfileId: data.deliveryProfileId,
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



    async findSkuById(skuId: string, tx?: DbOrTx) {
        const db = tx || this.db;
        return db.query.skus.findFirst({
            where: eq(wmsTables.skus.id, skuId)
        });
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

    private async _generateAndSetDefaultBarcode(skuId: string, db: DbOrTx): Promise<string> {
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
                const existingWarehouse = await this.db.query.warehouses.findFirst({
                    where: eq(wmsTables.warehouses.id, warehouseData.id),
                });

                if (!existingWarehouse) {
                    await this.db.insert(wmsTables.warehouses).values({
                        id: warehouseData.id,
                        name: warehouseData.name,
                        type: warehouseData.type,
                        location: warehouseData.location,
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