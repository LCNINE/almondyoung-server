import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { eq, and, isNull } from 'drizzle-orm';
import { CreateStockEntryBySkuIdDto } from '../../inbound/dto/create-stock-entry-by-skuid.dto';
import { SkuCreationSource } from '../dto/sku/create-sku.dto';
import { InventoryService } from './inventory.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { InventoryCommandService } from '../services/inventory-command.service';

@Injectable()
export class StockEventService {
    private readonly logger = new Logger(StockEventService.name);

    constructor(
        @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
        private readonly inventoryService: InventoryService,
        private readonly eventStore: StockEventStore,
        private readonly commandService: InventoryCommandService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
        return tx ? fn(tx) : this.db.transaction(fn);
    }


    /**
     * 안전한 SKU ID 기반 재고 입고 처리
     * - 자동 SKU 생성 없음
     * - SKU ID로 직접 조회
     * - 데이터 무결성 보장
     */
    async createStockEntryBySkuId(dto: CreateStockEntryBySkuIdDto, tx?: DbTx) {
        const {
            skuId,
            variantId,
            warehouseId,
            locationId,
            quantity,
            stockType,
            reason,
            subBarcode,
            packingUnit
        } = dto;

        return this.inTx(async (executor) => {
            // SKU ID로 직접 조회, 자동 생성 없음
            const sku = await executor.query.skus.findFirst({
                where: eq(wmsTables.skus.id, skuId)
            });

            if (!sku) {
                throw new BadRequestException(`SKU not found: ${skuId}`);
            }

            if (quantity < 0) {
                throw new BadRequestException('재고 수량은 음수일 수 없습니다.');
            }

            // 재고 이벤트 생성
            await this.commandService.receive({
                skuId: sku.id,
                toWarehouseId: warehouseId,
                toLocationId: locationId ?? null,
                quantity,
                occurredAt: new Date(),
                idempotencyKey: undefined,
                reason: reason || `stock_entry_${variantId ? `for_variant_${variantId}` : 'manual'}`,
            }, executor);

            // 서브 바코드가 있으면 바코드 테이블에 추가
            if (subBarcode) {
                await executor.insert(wmsTables.skuBarcodes).values({
                    skuId: sku.id,
                    barcode: subBarcode,
                    barcodeType: 'standard',
                    packingUnit: packingUnit || null,
                }).onConflictDoNothing();
            }

            this.logger.log(`안전한 재고 입고 완료: SKU ${sku.id}, 수량: ${quantity}, 창고: ${warehouseId}`);

            return { skuId: sku.id, variantId };
        }, tx);
    }

    // 재고 출고 처리 (보류)
    async processStockOut(
        stockId: string,
        quantity: number,
        orderId?: string,
        reason?: string
    ) {
        throw new BadRequestException('processStockOut: transition-based 구현 대기');
    }

    // 재고 예약 처리
    async reserveStock(
        stockId: string,
        quantity: number,
        orderId: string,
        reason?: string
    ) {
        throw new BadRequestException('reserveStock: transition-based 구현 대기');
    }

    // 재고 예약 해제
    async releaseReservation(
        stockId: string,
        quantity: number,
        orderId: string,
        reason?: string
    ) {
        throw new BadRequestException('releaseReservation: transition-based 구현 대기');
    }

    // 창고 간 재고 이동
    async transferBetweenWarehouses(
        stockId: string,
        toWarehouseId: string,
        quantity: number,
        reason?: string
    ) {
        throw new BadRequestException('transferBetweenWarehouses: transition-based 구현 대기');
    }

    // 재고 손실 처리
    async processDamage(
        stockId: string,
        quantity: number,
        reason: string
    ) {
        throw new BadRequestException('processDamage: transition-based 구현 대기');
    }

    // 재고 반품 처리
    async processReturn(
        skuId: string,
        warehouseId: string,
        quantity: number,
        orderId: string,
        locationId?: string,
        reason?: string
    ) {
        throw new BadRequestException('processReturn: transition-based 구현 대기');
    }
}