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
import { StockSummaryRepository } from '../repositories/ stock-summary.repository';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];
type DbOrTx = DbTx | TypedDatabase<typeof wmsTables>;

@Injectable()
export class InventoryService implements OnModuleInit {
    private readonly logger = new Logger(InventoryService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly eventStore: StockEventStore,
        private readonly summaryRepo: StockSummaryRepository,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async onModuleInit() {
        await this._ensureDefaultWarehousesExist();
    }

    // ****************************************************************
    // SKU 관리 도메인
    // ****************************************************************

    async createSku(createSkuDto: CreateSkuDto): Promise<SkuResponseDto> {
        return this.db.transaction(async (tx) => {
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

            return this.getSkuById(newSku.id);
        });
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

            return this.getSkuById(skuId);
        });
    }

    async deleteSku(skuId: string): Promise<void> {
        const activeStock = await this.db.query.stocks.findFirst({
            where: and(
                eq(wmsTables.stocks.skuId, skuId),
                isNull(wmsTables.stocks.destroyerEventId)
            ),
        });

        if (activeStock && activeStock.realQuantity > 0) {
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

    async getSkuById(skuId: string): Promise<SkuResponseDto> {
        const sku = await this.db.query.skus.findFirst({
            where: eq(wmsTables.skus.id, skuId),
        });

        if (!sku) {
            throw new NotFoundException(`SKU with ID ${skuId} not found`);
        }

        const barcodes = await this.db.query.skuBarcodes.findMany({
            where: eq(wmsTables.skuBarcodes.skuId, skuId),
        });

        const suppliers = await this.db
            .select({
                name: wmsTables.suppliers.name,
            })
            .from(wmsTables.skuSuppliers)
            .innerJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id))
            .where(eq(wmsTables.skuSuppliers.skuId, skuId));

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

        const conditions: any[] = [];

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

    async updateAlwaysSellableZeroStock(skuId: string, value: boolean): Promise<void> {
        const sku = await this.findSkuById(skuId);
        if (!sku) {
            throw new NotFoundException(`SKU with ID ${skuId} not found`);
        }

        if (!sku.inventoryManagement) {
            throw new BadRequestException('Cannot set alwaysSellableZeroStock for non-inventory managed SKU');
        }

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

    // ****************************************************************
    // 재고 관리 도메인
    // ****************************************************************

    async getCurrentStock(query: GetStockQueryDto) {
        if (this._canUseStockSummary(query)) {
            return this.getQuickStockSummary(query.skuId, query.warehouseId);
        }

        const { skuId, warehouseId, locationId, stockType, asOfTimestamp } = query;

        const stocks = await this.db.query.stocks.findMany({
            where: (s, { and, eq, isNull }) => and(
                skuId ? eq(s.skuId, skuId) : undefined,
                warehouseId ? eq(s.warehouseId, warehouseId) : undefined,
                locationId ? eq(s.locationId, locationId) : undefined,
                stockType ? eq(s.stockType, stockType) : undefined,
                isNull(s.destroyerEventId)
            ),
            orderBy: (s, { asc }) => [asc(s.skuId), asc(s.warehouseId), asc(s.locationId), asc(s.creatorEventId)],
        });

        const aggregatedStock = stocks.reduce((acc, stock) => {
            const key = `${stock.skuId}-${stock.warehouseId}-${stock.locationId || 'null'}-${stock.expiryDate?.toISOString() || 'null'}`;
            if (!acc[key]) {
                acc[key] = {
                    skuId: stock.skuId,
                    warehouseId: stock.warehouseId,
                    locationId: stock.locationId,
                    expiryDate: stock.expiryDate?.toISOString(),
                    stockType: stock.stockType,
                    realQuantity: 0,
                    reservedQuantity: 0,
                    availableQuantity: 0,
                    stockRows: [],
                };
            }
            acc[key].realQuantity += stock.realQuantity;
            acc[key].reservedQuantity += stock.reservedQuantity;
            acc[key].availableQuantity += stock.availableQuantity;
            acc[key].stockRows.push({
                id: stock.id,
                realQuantity: stock.realQuantity,
                reservedQuantity: stock.reservedQuantity,
                availableQuantity: stock.availableQuantity,
                creatorEventId: stock.creatorEventId,
                subBarcode: stock.subBarcode,
                packingUnit: stock.packingUnit,
            });
            return acc;
        }, {} as Record<string, any>);

        return Object.values(aggregatedStock);
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

        const stocks = await this.db.query.stocks.findMany({
            where: and(
                eq(wmsTables.stocks.skuId, skuId),
                eq(wmsTables.stocks.warehouseId, warehouseId),
                isNull(wmsTables.stocks.destroyerEventId)
            ),
            with: {
                location: true,
            },
            orderBy: (stocks, { asc }) => [
                asc(stocks.expiryDate),
                asc(stocks.creatorEventId),
            ],
        });

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
            details: stocks,
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
        if (delta === 0) {
            this.logger.log(`재고 조정 ${stockId}에 대한 델타가 0입니다. 변경사항이 적용되지 않았습니다.`);
            return;
        }

        return this.db.transaction(async (tx) => {
            const currentStock = await tx.query.stocks.findFirst({
                where: and(
                    eq(wmsTables.stocks.id, stockId),
                    isNull(wmsTables.stocks.destroyerEventId)
                ),
            });

            if (!currentStock) {
                throw new NotFoundException(`ID ${stockId}의 활성 재고 항목을 찾을 수 없습니다.`);
            }

            const sku = await this.findSkuById(currentStock.skuId, tx);
            if (!sku || !sku.inventoryManagement) {
                throw new BadRequestException(`SKU ${currentStock.skuId}가 물리적 재고 관리로 구성되지 않았습니다.`);
            }

            const newRealQuantity = currentStock.realQuantity + delta;
            if (newRealQuantity < 0) {
                throw new BadRequestException(`조정으로 인해 재고 ID ${stockId}의 실제 수량이 음수가 됩니다.`);
            }

            const eventType = 'ADJUST_MANUAL';

            // 이벤트 생성 (델타값 저장)
            const event = await this.eventStore.createEvent({
                type: eventType,
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: currentStock.locationId,
                deltaQuantity: delta,
                relatedStockId: stockId,
                reason: `관리자 수동 조정 - ${reason}`,
                expiresStockRowId: currentStock.id,
            }, tx);

            // 재고 현황 테이블 업데이트
            await this.summaryRepo.applyDelta(
                currentStock.skuId,
                currentStock.warehouseId,
                delta,
                eventType,
                event.id,
                tx
            );

            // 기존 재고 만료
            await tx.update(wmsTables.stocks)
                .set({ destroyerEventId: event.id })
                .where(eq(wmsTables.stocks.id, stockId));

            // 새 재고 생성
            const newAvailableQuantity = this._calculateAvailableQuantity(newRealQuantity, currentStock.reservedQuantity);
            const [newStock] = await tx.insert(wmsTables.stocks).values({
                ...currentStock,
                id: undefined,
                creatorEventId: event.id,
                destroyerEventId: null,
                realQuantity: newRealQuantity,
                availableQuantity: newAvailableQuantity,
            }).returning();

            await tx.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, event.id));

            if (sku.preStockSellable && delta > 0 && newRealQuantity > 0) {
                await this._updatePreStockSellableInternal(sku.id, false, tx);
            }

            this.logger.log(`관리자 수동 조정 완료: 재고 ${stockId}, 델타 ${delta}, 새 수량 ${newRealQuantity}`);
            return newStock;
        });
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
        return this.eventStore.cancelStockEvent(eventId, reason);
    }

    async rebuildStockSummary(skuId: string, warehouseId: string): Promise<void> {
        return this.summaryRepo.rebuild(skuId, warehouseId);
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
        const stocks = await this.db.select({
            skuId: wmsTables.stocks.skuId,
            skuName: wmsTables.skus.name,
            skuCode: wmsTables.skus.code,
            totalQuantity: sql<number>`sum(${wmsTables.stocks.realQuantity})`,
            totalReserved: sql<number>`sum(${wmsTables.stocks.reservedQuantity})`,
            totalAvailable: sql<number>`sum(${wmsTables.stocks.availableQuantity})`,
            locationCount: sql<number>`count(distinct ${wmsTables.stocks.locationId})`,
        })
            .from(wmsTables.stocks)
            .innerJoin(wmsTables.skus, eq(wmsTables.stocks.skuId, wmsTables.skus.id))
            .where(and(
                eq(wmsTables.stocks.warehouseId, warehouseId),
                isNull(wmsTables.stocks.destroyerEventId)
            ))
            .groupBy(wmsTables.stocks.skuId, wmsTables.skus.name, wmsTables.skus.code);

        return {
            warehouseId,
            summary: stocks,
            totalSkus: stocks.length,
            totalQuantity: stocks.reduce((sum, item) => sum + item.totalQuantity, 0),
            totalAvailable: stocks.reduce((sum, item) => sum + item.totalAvailable, 0),
        };
    }

    // ****************************************************************
    // Helper Methods
    // ****************************************************************

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
        const stockCount = await this.db.select({ count: sql<number>`count(*)` })
            .from(wmsTables.stocks)
            .where(and(
                eq(wmsTables.stocks.warehouseId, warehouseId),
                isNull(wmsTables.stocks.destroyerEventId)
            ));

        return stockCount[0].count > 0;
    }
}