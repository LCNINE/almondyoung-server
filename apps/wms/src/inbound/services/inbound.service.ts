import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { CreateInboundDto } from '../dto/create-inbound.dto';
import { CreateStockEntryDto } from '../dto/create-stock-entry.dto';
import { InventoryService } from '../../inventory/services/inventory.service';
import { StockEventService } from '../../inventory/services/stock-event.service';

@Injectable()
export class InboundService {
    private readonly logger = new Logger(InboundService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly inventoryService: InventoryService,
        private readonly stockEventService: StockEventService,
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
            const targetWarehouseId = warehouseId || this.inventoryService.getDefaultWarehouseIdByType(supplierType);

            const eventType = supplierType === 'overseas' ? 'IN_OVERSEAS' : 'IN_DOMESTIC';
            const [inboundEvent] = await tx.insert(wmsTables.stockEvents).values({
                skuId,
                warehouseId: targetWarehouseId,
                locationId,
                eventType,
                quantity,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
                orderId: purchaseOrderId,
                reason: `${supplierType} 거래처 입고 - ${reason}`,
            }).returning();

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
                .set({ createsStockRowId: newStock.id, stockId: newStock.id })
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

    // TODO: 발주로부터 입고 리스트 생성 메서드

    // TODO: 입고 바코드 스캔 메서드

}