import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { CreateStockEntryDto } from '../../inbound/dto/create-stock-entry.dto';
import { SkuCreationSource } from '../dto/sku/create-sku.dto';
import { InventoryService } from './inventory.service';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class StockEventService {
    private readonly logger = new Logger(StockEventService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly inventoryService: InventoryService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async createStockEntry(dto: CreateStockEntryDto, tx?: DbTx) {
        const db = tx || this.db;
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
            reason,
            orderId
        } = dto;

        let sku = await db.query.skus.findFirst({ where: eq(wmsTables.skus.name, skuName) });

        if (!sku) {
            this.logger.warn(`SKU with name '${skuName}' not found. Auto-creating SKU.`);

            const creationSource = variantId
                ? SkuCreationSource.AUTO_MATCHING
                : SkuCreationSource.MANUAL_ENTRY;

            sku = await this.inventoryService._createSkuInternal({
                name: skuName,
                inventoryManagement: inventoryManagement ?? true,
                source: creationSource,
            }, db);
        } else {
            if (!sku.inventoryManagement) {
                throw new BadRequestException(`기존 SKU ${sku.id}는 재고 관리 대상이 아닙니다.`);
            }
        }

        if (quantity < 0) {
            throw new BadRequestException('초기 재고 항목 수량은 음수일 수 없습니다.');
        }

        const execution = async (executor: DbTx) => {
            if (!sku) {
                throw new Error('SKU 정보가 없습니다. 재고 이벤트 생성에 실패했습니다.');
            }
            const [creatingEvent] = await executor.insert(wmsTables.stockEvents).values({
                skuId: sku.id,
                warehouseId,
                locationId,
                eventType: 'IN',
                quantity,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
                orderId,
                reason: reason || `initial_stock_creation${variantId ? `_for_variant_${variantId}` : ''}`,
            }).returning();

            if (!creatingEvent) throw new Error('재고 생성 이벤트 생성에 실패했습니다.');

            const [newStock] = await executor.insert(wmsTables.stocks).values({
                skuId: sku.id,
                warehouseId,
                locationId,
                stockType,
                realQuantity: quantity,
                reservedQuantity: 0,
                availableQuantity: quantity,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
                barcodeType,
                subBarcode,
                packingUnit,
                creatorEventId: creatingEvent.id,
            }).returning();

            if (!newStock) throw new Error('새 재고 항목 생성에 실패했습니다.');

            await executor.update(wmsTables.stockEvents)
                .set({ createsStockRowId: newStock.id, stockId: newStock.id })
                .where(eq(wmsTables.stockEvents.id, creatingEvent.id));

            if (sku.preStockSellable && quantity > 0) {
                await this.inventoryService._updatePreStockSellableInternal(sku.id, false, executor);
            }

            this.logger.log(`새 재고 항목 생성됨: ${newStock.id} for SKU ${sku.id}, 수량: ${quantity}.`);

            return { ...newStock, variantId };
        };

        if (tx) {
            return execution(tx);
        } else {
            return this.db.transaction(execution);
        }
    }

    // TODO: 이벤트 기반 재고 재계산 메서드

    // TODO: 이벤트 이력 조회 메서드

}