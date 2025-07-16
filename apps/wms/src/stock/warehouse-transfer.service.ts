// apps/wms/src/stock/warehouse-transfer.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { InterWarehouseTransferDto } from './dto/inter-warehouse-transfer.dto';
import { IntraWarehouseMoveDto } from './dto/intra-warehouse-move.dto';

@Injectable()
export class WarehouseTransferService {
    private readonly logger = new Logger(WarehouseTransferService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly db: TypedDatabase<typeof wmsTables>,
    ) { }

    /**
     * 창고 간 재고 이동
     */
    async transferBetweenWarehouses(dto: InterWarehouseTransferDto) {
        const { fromWarehouseId, toWarehouseId, skuId, quantity, reason } = dto;

        if (fromWarehouseId === toWarehouseId) {
            throw new BadRequestException('출발 창고와 도착 창고가 동일합니다.');
        }

        if (quantity <= 0) {
            throw new BadRequestException('이동 수량은 0보다 커야 합니다.');
        }

        return this.db.transaction(async (tx) => {
            // 1. 출발 창고의 가용 재고 확인
            const sourceStocks = await tx.query.stocks.findMany({
                where: and(
                    eq(wmsTables.stocks.skuId, skuId),
                    eq(wmsTables.stocks.warehouseId, fromWarehouseId),
                    isNull(wmsTables.stocks.destroyerEventId),
                    gte(wmsTables.stocks.availableQuantity, 1)
                ),
                orderBy: (stocks, { asc }) => [
                    asc(stocks.expiryDate), // 유통기한 빠른 것부터
                    asc(stocks.creatorEventId) // FIFO
                ],
            });

            if (!sourceStocks.length) {
                throw new NotFoundException(`출발 창고에 SKU ${skuId}의 가용 재고가 없습니다.`);
            }

            // 총 가용 재고 계산
            const totalAvailable = sourceStocks.reduce((sum, stock) => sum + stock.availableQuantity, 0);
            if (totalAvailable < quantity) {
                throw new BadRequestException(
                    `가용 재고(${totalAvailable})가 이동 수량(${quantity})보다 적습니다.`
                );
            }

            // 2. 출발 창고에서 차감할 재고들 처리
            let remainingQuantity = quantity;
            const transferDetails: Array<{
                stockId: string;
                transferQuantity: number;
                expiryDate: Date | null;
                manufacturedAt: Date | null;
            }> = [];

            for (const sourceStock of sourceStocks) {
                if (remainingQuantity <= 0) break;

                const transferQuantity = Math.min(sourceStock.availableQuantity, remainingQuantity);

                // 2-1. 출발 창고에서 OUT 이벤트 생성
                const [outEvent] = await tx.insert(wmsTables.stockEvents).values({
                    stockId: sourceStock.id,
                    skuId: sourceStock.skuId,
                    warehouseId: fromWarehouseId,
                    fromWarehouseId: fromWarehouseId,
                    toWarehouseId: toWarehouseId,
                    eventType: 'MOVE_INTER_WAREHOUSE',
                    quantity: -transferQuantity,
                    reason: `창고 이동: ${fromWarehouseId} → ${toWarehouseId} - ${reason}`,
                    expiresStockRowId: sourceStock.id,
                }).returning();

                // 2-2. 기존 재고 만료 처리
                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: outEvent.id })
                    .where(eq(wmsTables.stocks.id, sourceStock.id));

                // 2-3. 차감 후 남은 수량이 있으면 새 재고 생성
                if (sourceStock.realQuantity > transferQuantity) {
                    const [newSourceStock] = await tx.insert(wmsTables.stocks).values({
                        ...sourceStock,
                        id: undefined,
                        creatorEventId: outEvent.id,
                        destroyerEventId: null,
                        realQuantity: sourceStock.realQuantity - transferQuantity,
                        availableQuantity: sourceStock.availableQuantity - transferQuantity,
                    }).returning();

                    await tx.update(wmsTables.stockEvents)
                        .set({ createsStockRowId: newSourceStock.id })
                        .where(eq(wmsTables.stockEvents.id, outEvent.id));
                }

                transferDetails.push({
                    stockId: sourceStock.id,
                    transferQuantity,
                    expiryDate: sourceStock.expiryDate,
                    manufacturedAt: sourceStock.manufacturedAt,
                });

                remainingQuantity -= transferQuantity;
            }

            // 3. 도착 창고에 재고 추가
            for (const detail of transferDetails) {
                // 3-1. IN 이벤트 생성
                const [inEvent] = await tx.insert(wmsTables.stockEvents).values({
                    skuId,
                    warehouseId: toWarehouseId,
                    fromWarehouseId: fromWarehouseId,
                    toWarehouseId: toWarehouseId,
                    eventType: 'MOVE_INTER_WAREHOUSE',
                    quantity: detail.transferQuantity,
                    expiryDate: detail.expiryDate,
                    manufacturedAt: detail.manufacturedAt,
                    reason: `창고 이동: ${fromWarehouseId} → ${toWarehouseId} - ${reason}`,
                }).returning();

                // 3-2. 새 재고 생성
                const [newStock] = await tx.insert(wmsTables.stocks).values({
                    skuId,
                    warehouseId: toWarehouseId,
                    locationId: null, // 도착 창고의 기본 위치 (추후 입고 처리 시 지정)
                    stockType: 'physical',
                    realQuantity: detail.transferQuantity,
                    reservedQuantity: 0,
                    availableQuantity: detail.transferQuantity,
                    creatorEventId: inEvent.id,
                    expiryDate: detail.expiryDate,
                    manufacturedAt: detail.manufacturedAt,
                }).returning();

                // 3-3. 이벤트에 생성된 재고 ID 연결
                await tx.update(wmsTables.stockEvents)
                    .set({ createsStockRowId: newStock.id, stockId: newStock.id })
                    .where(eq(wmsTables.stockEvents.id, inEvent.id));
            }

            this.logger.log(
                `창고 간 이동 완료: SKU ${skuId}, 수량 ${quantity}, ` +
                `${fromWarehouseId} → ${toWarehouseId}`
            );

            return {
                skuId,
                quantity,
                fromWarehouseId,
                toWarehouseId,
                transferDetails: transferDetails.length,
                reason,
            };
        });
    }

    /**
     * 창고 내 위치 이동
     */
    async moveWithinWarehouse(dto: IntraWarehouseMoveDto) {
        const { stockId, newLocationId, reason } = dto;

        return this.db.transaction(async (tx) => {
            // 1. 현재 재고 확인
            const currentStock = await tx.query.stocks.findFirst({
                where: and(
                    eq(wmsTables.stocks.id, stockId),
                    isNull(wmsTables.stocks.destroyerEventId)
                ),
            });

            if (!currentStock) {
                throw new NotFoundException(`활성 재고 ${stockId}를 찾을 수 없습니다.`);
            }

            // 2. 새 위치 확인
            const newLocation = await tx.query.locations.findFirst({
                where: eq(wmsTables.locations.id, newLocationId),
            });

            if (!newLocation) {
                throw new NotFoundException(`위치 ${newLocationId}를 찾을 수 없습니다.`);
            }

            // 같은 창고인지 확인
            if (newLocation.warehouseId !== currentStock.warehouseId) {
                throw new BadRequestException('다른 창고의 위치로는 이동할 수 없습니다. 창고 간 이동을 사용하세요.');
            }

            // 3. MOVE 이벤트 생성
            const [moveEvent] = await tx.insert(wmsTables.stockEvents).values({
                stockId: currentStock.id,
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                eventType: 'MOVE_INTRA_WAREHOUSE',
                quantity: 0, // 위치 이동은 수량 변경 없음
                locationId: newLocationId,
                reason: `위치 이동: ${currentStock.locationId || 'N/A'} → ${newLocationId} - ${reason}`,
                expiresStockRowId: currentStock.id,
            }).returning();

            // 4. 기존 재고 만료
            await tx.update(wmsTables.stocks)
                .set({ destroyerEventId: moveEvent.id })
                .where(eq(wmsTables.stocks.id, stockId));

            // 5. 새 위치에 재고 생성
            const [newStock] = await tx.insert(wmsTables.stocks).values({
                ...currentStock,
                id: undefined,
                locationId: newLocationId,
                creatorEventId: moveEvent.id,
                destroyerEventId: null,
            }).returning();

            // 6. 이벤트에 생성된 재고 ID 연결
            await tx.update(wmsTables.stockEvents)
                .set({ createsStockRowId: newStock.id })
                .where(eq(wmsTables.stockEvents.id, moveEvent.id));

            this.logger.log(
                `창고 내 위치 이동 완료: Stock ${stockId}, ` +
                `위치 ${currentStock.locationId || 'N/A'} → ${newLocationId}`
            );

            return newStock;
        });
    }
}