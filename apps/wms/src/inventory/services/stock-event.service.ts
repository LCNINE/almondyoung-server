import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { eq, and, isNull } from 'drizzle-orm';
import { CreateStockEntryDto } from '../../inbound/dto/create-stock-entry.dto';
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

    // 재고 입고 처리 (transition-based)
    async createStockEntry(dto: CreateStockEntryDto, tx?: DbTx) {
        const {
            variantId,
            skuName,
            inventoryManagement,
            warehouseId,
            quantity,
            stockType,
            locationId,
            expiryDate,
            manufacturedAt,
            barcodeType,
            subBarcode,
            packingUnit,
            reason
        } = dto;

        const execution = async (executor: DbTx) => {
            let sku = await executor.query.skus.findFirst({
                where: eq(wmsTables.skus.name, skuName)
            });

            if (!sku) {
                this.logger.warn(`SKU with name '${skuName}' not found. Auto-creating SKU.`);

                const creationSource = variantId
                    ? SkuCreationSource.AUTO_MATCHING
                    : SkuCreationSource.MANUAL_ENTRY;

                sku = await this.inventoryService._createSkuInternal({
                    name: skuName,
                    source: creationSource,
                }, executor);
            }

            if (quantity < 0) {
                throw new BadRequestException('초기 재고 항목 수량은 음수일 수 없습니다.');
            }

            await this.commandService.receive({
                skuId: sku.id,
                toWarehouseId: warehouseId,
                toLocationId: locationId ?? null,
                quantity,
                occurredAt: new Date(),
                idempotencyKey: undefined,
                reason: reason || `initial_stock_creation${variantId ? `_for_variant_${variantId}` : ''}`,
            }, executor);

            this.logger.log(`입고 이벤트 생성: SKU ${sku.id}, 수량: ${quantity}, 창고: ${warehouseId}`);

            return { skuId: sku.id, variantId };
        };

        if (tx) {
            return execution(tx);
        } else {
            return this.db.transaction(execution);
        }
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