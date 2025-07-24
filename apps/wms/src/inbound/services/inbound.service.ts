import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService, TypedDatabase } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { CreateInboundDto } from '../dto/create-inbound.dto';
import { CreateStockEntryDto } from '../dto/create-stock-entry.dto';
import { InventoryService } from '../../inventory/services/inventory.service';
import { StockEventService } from '../../inventory/services/stock-event.service';
import { StockEventStore } from '../../inventory/repositories/stock-event.store';
import { StockSummaryRepository } from '../../inventory/repositories/ stock-summary.repository';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class InboundService {
    private readonly logger = new Logger(InboundService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly inventoryService: InventoryService,
        private readonly stockEventService: StockEventService,
        private readonly eventStore: StockEventStore,
        private readonly summaryRepo: StockSummaryRepository,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async processInbound(dto: CreateInboundDto) {
        const { skuId, quantity, supplierType, warehouseId, locationId, expiryDate, manufacturedAt, reason, purchaseOrderId } = dto;

        const sku = await this.inventoryService.findSkuById(skuId);
        if (!sku) {
            throw new NotFoundException(`SKU ${skuId}를 찾을 수 없습니다.`);
        }

        if (!sku.inventoryManagement) {
            throw new BadRequestException(`SKU ${skuId}는 재고 관리 대상이 아닙니다.`);
        }

        return this.db.transaction(async (tx) => {
            // 창고 결정 (지정되지 않으면 거래처 타입별 기본 창고)
            const targetWarehouseId = warehouseId || this.inventoryService.getDefaultWarehouseIdByType(supplierType);
            const eventType = supplierType === 'overseas' ? 'IN_OVERSEAS' : 'IN_DOMESTIC';

            // 입고 이벤트 생성 - 이벤트 스토어 사용
            const inboundEvent = await this.eventStore.createEvent({
                type: eventType,
                skuId,
                warehouseId: targetWarehouseId,
                locationId,
                deltaQuantity: quantity,
                orderId: purchaseOrderId,
                reason: `${supplierType} 거래처 입고 - ${reason}`,
                expiryDate: expiryDate ? new Date(expiryDate) : undefined,
                manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : undefined,
            }, tx);

            // 재고 현황 업데이트 - Repository 사용
            await this.summaryRepo.applyDelta(
                skuId,
                targetWarehouseId,
                quantity,
                eventType,
                inboundEvent.id,
                tx
            );

            const [newStock] = await tx.insert(wmsTables.stocks).values({
                skuId,
                warehouseId: targetWarehouseId,
                locationId,
                stockType: 'physical',
                realQuantity: quantity,
                reservedQuantity: 0,
                availableQuantity: quantity,
                creatorEventId: inboundEvent.id,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
            }).returning();

            await tx.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, inboundEvent.id));

            if (sku.preStockSellable && quantity > 0) {
                await this.inventoryService._updatePreStockSellableInternal(sku.id, false, tx);
            }

            this.logger.log(
                `입고 처리 완료: SKU ${sku.name}, 수량 ${quantity}, ` +
                `창고 ${targetWarehouseId}, 거래처 유형 ${supplierType}`
            );

            return newStock;
        });
    }

    async createStockEntry(dto: CreateStockEntryDto) {
        return this.stockEventService.createStockEntry(dto);
    }

    // 입고 예정 목록 조회
    async getInboundPending(warehouseId?: string) {
        // 구매 주문 중 아직 입고되지 않은 항목 조회
        const pendingPOs = await this.db.query.purchaseOrders.findMany({
            where: eq(wmsTables.purchaseOrders.status, 'confirmed'),
        });

        // 창고별 필터링
        const filtered = warehouseId
            ? pendingPOs.filter(po => {
                // 해외 거래처면 해외 창고, 국내는 국내 창고
                const expectedWarehouse = po.type === 'foreign'
                    ? this.inventoryService.getDefaultWarehouseIdByType('overseas')
                    : this.inventoryService.getDefaultWarehouseIdByType('domestic');
                return expectedWarehouse === warehouseId;
            })
            : pendingPOs;

        const poIds = filtered.map(po => po.id);
        const supplierIds = filtered.map(po => po.supplierId).filter(id => id);

        const purchaseOrderLines = await this.db.query.purchaseOrderLines.findMany({
            where: sql`${wmsTables.purchaseOrderLines.poId} = ANY(${poIds})`,
        });

        const skuIds = purchaseOrderLines.map(line => line.skuId);
        const skus = await this.db.query.skus.findMany({
            where: sql`${wmsTables.skus.id} = ANY(${skuIds})`,
        });

        const suppliers = await this.db.query.suppliers.findMany({
            where: sql`${wmsTables.suppliers.id} = ANY(${supplierIds})`,
        });

        const skuMap = new Map(skus.map(sku => [sku.id, sku]));
        const supplierMap = new Map(suppliers.map(supplier => [supplier.id, supplier]));

        const inboundPending = filtered.map(po => {
            const poLines = purchaseOrderLines.filter(line => line.poId === po.id);
            const supplier = po.supplierId ? supplierMap.get(po.supplierId) : null;

            return {
                purchaseOrderId: po.id,
                supplierName: supplier?.name || 'Unknown',
                type: po.type,
                expectedArrival: po.expectedArrival,
                items: poLines.map(line => {
                    const sku = skuMap.get(line.skuId);
                    return {
                        skuId: line.skuId,
                        skuName: sku?.name || 'Unknown',
                        skuCode: sku?.code || 'Unknown',
                        quantity: line.quantity,
                        unitPrice: line.unitPrice,
                    };
                }),
                totalQuantity: poLines.reduce((sum, line) => sum + line.quantity, 0),
                totalValue: poLines.reduce((sum, line) => sum + (line.quantity * (line.unitPrice || 0)), 0),
            };
        });

        return {
            warehouseId,
            totalPendingOrders: inboundPending.length,
            totalPendingQuantity: inboundPending.reduce((sum, po) => sum + po.totalQuantity, 0),
            pendingOrders: inboundPending,
        };
    }

    // 입고 실적 조회
    async getInboundHistory(skuId?: string, warehouseId?: string, days: number = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // 이벤트 스토어에서 입고 이벤트 조회
        const events = await this.eventStore.getEventHistory(
            skuId || '', // skuId가 없으면 전체 조회
            warehouseId,
            startDate.toISOString().split('T')[0],
            new Date().toISOString().split('T')[0]
        );

        // 입고 관련 이벤트만 필터링
        const inboundEvents = events.filter(e =>
            e.eventType === 'IN' ||
            e.eventType === 'IN_DOMESTIC' ||
            e.eventType === 'IN_OVERSEAS' ||
            e.eventType === 'IN_RETURN'
        );

        // 일별 집계
        const dailyStats: Record<string, { quantity: number; events: number }> = {};

        inboundEvents.forEach(event => {
            const date = new Date(event.eventTimestamp).toISOString().split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = { quantity: 0, events: 0 };
            }
            dailyStats[date].quantity += event.deltaQuantity;
            dailyStats[date].events += 1;
        });

        return {
            period: `Last ${days} days`,
            totalInboundQuantity: inboundEvents.reduce((sum, e) => sum + e.deltaQuantity, 0),
            totalInboundEvents: inboundEvents.length,
            domesticInbounds: inboundEvents.filter(e => e.eventType === 'IN_DOMESTIC').length,
            overseasInbounds: inboundEvents.filter(e => e.eventType === 'IN_OVERSEAS').length,
            returnInbounds: inboundEvents.filter(e => e.eventType === 'IN_RETURN').length,
            dailyStats,
            recentEvents: inboundEvents.slice(0, 10), // 최근 10건
        };
    }

    // 입고 검수 (바코드 스캔)
    async verifyInboundByBarcode(barcode: string, expectedSkuId?: string) {
        // 바코드로 SKU 조회
        const skuBarcode = await this.db.query.skuBarcodes.findFirst({
            where: eq(wmsTables.skuBarcodes.barcode, barcode),
        });

        if (!skuBarcode) {
            // 기본 바코드로도 조회
            const sku = await this.db.query.skus.findFirst({
                where: eq(wmsTables.skus.defaultBarcode, barcode),
            });

            if (!sku) {
                throw new NotFoundException(`바코드 ${barcode}에 해당하는 SKU를 찾을 수 없습니다.`);
            }

            // 예상 SKU와 다른 경우
            if (expectedSkuId && sku.id !== expectedSkuId) {
                throw new BadRequestException(
                    `스캔한 SKU(${sku.code})가 예상 SKU와 다릅니다.`
                );
            }

            return {
                skuId: sku.id,
                skuCode: sku.code,
                skuName: sku.name,
                barcode: sku.defaultBarcode,
                barcodeType: 'default',
            };
        }

        // SKU 정보 별도 조회
        const sku = await this.db.query.skus.findFirst({
            where: eq(wmsTables.skus.id, skuBarcode.skuId),
        });

        // 예상 SKU와 다른 경우
        if (expectedSkuId && skuBarcode.skuId !== expectedSkuId) {
            throw new BadRequestException(
                `스캔한 SKU(${sku?.code})가 예상 SKU와 다릅니다.`
            );
        }

        return {
            skuId: skuBarcode.skuId,
            skuCode: sku?.code,
            skuName: sku?.name,
            barcode: skuBarcode.barcode,
            barcodeType: skuBarcode.barcodeType,
            packingUnit: skuBarcode.packingUnit,
        };
    }
}