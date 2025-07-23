import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { InventoryService } from '../../inventory/services/inventory.service';

@Injectable()
export class OutboundService {
    private readonly logger = new Logger(OutboundService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly inventoryService: InventoryService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async processOutbound(stockId: string, quantity: number, reason: string, orderId?: string) {
        if (quantity <= 0) {
            throw new BadRequestException('출고 수량은 0보다 커야 합니다.');
        }

        return this.db.transaction(async (tx) => {
            const currentStock = await tx.query.stocks.findFirst({
                where: and(
                    eq(wmsTables.stocks.id, stockId),
                    isNull(wmsTables.stocks.destroyerEventId)
                ),
            });

            if (!currentStock) {
                throw new NotFoundException(`활성 재고 ${stockId}를 찾을 수 없습니다.`);
            }

            if (currentStock.availableQuantity < quantity) {
                throw new BadRequestException(
                    `가용 재고(${currentStock.availableQuantity})가 출고 수량(${quantity})보다 적습니다.`
                );
            }

            const [outboundEvent] = await tx.insert(wmsTables.stockEvents).values({
                stockId: currentStock.id,
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: currentStock.locationId,
                eventType: 'OUT_ORDER',
                quantity: -quantity,
                orderId,
                reason: `출고 - ${reason}`,
                expiresStockRowId: currentStock.id,
            }).returning();

            await tx.update(wmsTables.stocks)
                .set({ destroyerEventId: outboundEvent.id })
                .where(eq(wmsTables.stocks.id, stockId));

            const remainingQuantity = currentStock.realQuantity - quantity;
            if (remainingQuantity > 0) {
                const [newStock] = await tx.insert(wmsTables.stocks).values({
                    ...currentStock,
                    id: undefined,
                    creatorEventId: outboundEvent.id,
                    destroyerEventId: null,
                    realQuantity: remainingQuantity,
                    availableQuantity: currentStock.availableQuantity - quantity,
                }).returning();

                await tx.update(wmsTables.stockEvents)
                    .set({ createsStockRowId: newStock.id })
                    .where(eq(wmsTables.stockEvents.id, outboundEvent.id));

                this.logger.log(`출고 후 남은 재고: ${remainingQuantity}`);
            }

            this.logger.log(
                `출고 처리 완료: Stock ${stockId}, SKU ${currentStock.skuId}, ` +
                `수량 ${quantity}, 창고 ${currentStock.warehouseId}`
            );

            return {
                processedQuantity: quantity,
                remainingQuantity,
                orderId,
            };
        });
    }

    // TODO: 주문들로부터 출고리스트 생성 메서드


    // TODO: 출고리스트로부터 피킹리스트 생성 메서드

    // TODO: 출고 작업 상태 업데이트 메서드
}