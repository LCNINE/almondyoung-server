import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { InterWarehouseTransferDto } from '../dto/inter-warehouse-transfer.dto';
import { IntraWarehouseMoveDto } from '../dto/intra-warehouse-move.dto';
import { StockEventStore } from '../../inventory/repositories/stock-event.store';
import { StockSummaryRepository } from '../../inventory/repositories/ stock-summary.repository';

@Injectable()
export class MovementService {
    private readonly logger = new Logger(MovementService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly eventStore: StockEventStore,
        private readonly summaryRepo: StockSummaryRepository,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async transferBetweenWarehouses(dto: InterWarehouseTransferDto) {
        const { fromWarehouseId, toWarehouseId, skuId, quantity, reason } = dto;

        if (fromWarehouseId === toWarehouseId) {
            throw new BadRequestException('출발 창고와 도착 창고가 동일합니다.');
        }

        if (quantity <= 0) {
            throw new BadRequestException('이동 수량은 0보다 커야 합니다.');
        }

        return this.db.transaction(async (tx) => {
            const fromSummary = await tx.query.stockSummary.findFirst({
                where: and(
                    eq(wmsTables.stockSummary.skuId, skuId),
                    eq(wmsTables.stockSummary.warehouseId, fromWarehouseId)
                ),
            });

            if (!fromSummary || fromSummary.availableQuantity < quantity) {
                throw new BadRequestException(
                    `출발 창고의 가용 재고(${fromSummary?.availableQuantity || 0})가 이동 수량(${quantity})보다 적습니다.`
                );
            }

            const sourceStocks = await tx.query.stocks.findMany({
                where: and(
                    eq(wmsTables.stocks.skuId, skuId),
                    eq(wmsTables.stocks.warehouseId, fromWarehouseId),
                    isNull(wmsTables.stocks.destroyerEventId),
                    gte(wmsTables.stocks.availableQuantity, 1)
                ),
                orderBy: (stocks, { asc }) => [
                    asc(stocks.expiryDate),
                    asc(stocks.creatorEventId)
                ],
            });

            let remainingQuantity = quantity;
            const transferDetails: Array<{
                stockId: string;
                transferQuantity: number;
                expiryDate: Date | null;
                manufacturedAt: Date | null;
            }> = [];

            // 1. 출발 창고에서 출고 처리
            for (const sourceStock of sourceStocks) {
                if (remainingQuantity <= 0) break;

                const transferQuantity = Math.min(sourceStock.availableQuantity, remainingQuantity);

                // 출고 이벤트 생성 - 이벤트 스토어 사용
                const outEvent = await this.eventStore.createEvent({
                    type: 'MOVE_INTER_WAREHOUSE',
                    skuId: sourceStock.skuId,
                    warehouseId: fromWarehouseId,
                    locationId: sourceStock.locationId,
                    deltaQuantity: -transferQuantity,
                    fromWarehouseId: fromWarehouseId,
                    toWarehouseId: toWarehouseId,
                    relatedStockId: sourceStock.id,
                    reason: `창고 이동: ${fromWarehouseId} → ${toWarehouseId} - ${reason}`,
                    expiresStockRowId: sourceStock.id,
                }, tx);

                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: outEvent.id })
                    .where(eq(wmsTables.stocks.id, sourceStock.id));

                // 부분 이동인 경우 새 재고 레코드 생성
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

            // 재고 현황 업데이트 - 출발 창고 (Repository 사용)
            await this.summaryRepo.applyDelta(
                skuId,
                fromWarehouseId,
                -quantity,
                'MOVE_INTER_WAREHOUSE',
                transferDetails[0] ? transferDetails[0].stockId : '',
                tx
            );

            // 도착 창고에 입고 처리
            const inEventIds: string[] = [];
            for (const detail of transferDetails) {
                const inEvent = await this.eventStore.createEvent({
                    type: 'MOVE_INTER_WAREHOUSE',
                    skuId,
                    warehouseId: toWarehouseId,
                    deltaQuantity: detail.transferQuantity,
                    fromWarehouseId: fromWarehouseId,
                    toWarehouseId: toWarehouseId,
                    expiryDate: detail.expiryDate || undefined,
                    manufacturedAt: detail.manufacturedAt || undefined,
                    reason: `창고 이동: ${fromWarehouseId} → ${toWarehouseId} - ${reason}`,
                }, tx);

                inEventIds.push(inEvent.id);

                const [newStock] = await tx.insert(wmsTables.stocks).values({
                    skuId,
                    warehouseId: toWarehouseId,
                    locationId: null, // 입고 시 위치 미지정
                    stockType: 'physical',
                    realQuantity: detail.transferQuantity,
                    reservedQuantity: 0,
                    availableQuantity: detail.transferQuantity,
                    creatorEventId: inEvent.id,
                    expiryDate: detail.expiryDate,
                    manufacturedAt: detail.manufacturedAt,
                }).returning();

                await tx.update(wmsTables.stockEvents)
                    .set({
                        createsStockRowId: newStock.id,
                        relatedStockId: newStock.id
                    })
                    .where(eq(wmsTables.stockEvents.id, inEvent.id));
            }

            // 재고 현황 업데이트 - 도착 창고
            await this.summaryRepo.applyDelta(
                skuId,
                toWarehouseId,
                quantity,
                'MOVE_INTER_WAREHOUSE',
                inEventIds[inEventIds.length - 1] || '',
                tx
            );

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

    async moveWithinWarehouse(dto: IntraWarehouseMoveDto) {
        const { stockId, newLocationId, reason } = dto;

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

            const newLocation = await tx.query.locations.findFirst({
                where: eq(wmsTables.locations.id, newLocationId),
            });

            if (!newLocation) {
                throw new NotFoundException(`위치 ${newLocationId}를 찾을 수 없습니다.`);
            }

            if (newLocation.warehouseId !== currentStock.warehouseId) {
                throw new BadRequestException('다른 창고의 위치로는 이동할 수 없습니다. 창고 간 이동을 사용하세요.');
            }

            // 창고 내 이동 이벤트 생성 (델타값 0)
            const moveEvent = await this.eventStore.createEvent({
                type: 'MOVE_INTRA_WAREHOUSE',
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: newLocationId,
                deltaQuantity: 0,
                relatedStockId: currentStock.id,
                reason: `위치 이동: ${currentStock.locationId || 'N/A'} → ${newLocationId} - ${reason}`,
                expiresStockRowId: currentStock.id,
            }, tx);

            await tx.update(wmsTables.stocks)
                .set({ destroyerEventId: moveEvent.id })
                .where(eq(wmsTables.stocks.id, stockId));

            const [newStock] = await tx.insert(wmsTables.stocks).values({
                ...currentStock,
                id: undefined,
                locationId: newLocationId,
                creatorEventId: moveEvent.id,
                destroyerEventId: null,
            }).returning();

            await tx.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, moveEvent.id));

            // 창고 내 이동은 재고 현황에 영향 없음

            this.logger.log(
                `창고 내 위치 이동 완료: Stock ${stockId}, ` +
                `위치 ${currentStock.locationId || 'N/A'} → ${newLocationId}`
            );

            return newStock;
        });
    }

    async getStocksByLocation(locationId: string) {
        return this.db.query.stocks.findMany({
            where: and(
                eq(wmsTables.stocks.locationId, locationId),
                isNull(wmsTables.stocks.destroyerEventId)
            ),
            with: {
                sku: true,
            },
            orderBy: (stocks, { asc }) => [
                asc(stocks.skuId),
                asc(stocks.expiryDate),
            ],
        });
    }

    async getLocationUtilization(warehouseId: string) {
        const locations = await this.db.query.locations.findMany({
            where: eq(wmsTables.locations.warehouseId, warehouseId),
        });

        const utilization = await Promise.all(
            locations.map(async (location) => {
                const stocks = await this.db.query.stocks.findMany({
                    where: and(
                        eq(wmsTables.stocks.locationId, location.id),
                        isNull(wmsTables.stocks.destroyerEventId)
                    ),
                });

                const totalQuantity = stocks.reduce((sum, stock) => sum + stock.realQuantity, 0);
                const skuCount = new Set(stocks.map(s => s.skuId)).size;

                return {
                    locationId: location.id,
                    locationCode: location.code,
                    stockCount: stocks.length,
                    skuCount,
                    totalQuantity,
                    isEmpty: stocks.length === 0,
                };
            })
        );

        // 활용도 통계
        const stats = {
            totalLocations: locations.length,
            occupiedLocations: utilization.filter(u => !u.isEmpty).length,
            emptyLocations: utilization.filter(u => u.isEmpty).length,
            utilizationRate: Math.round((utilization.filter(u => !u.isEmpty).length / locations.length) * 100),
            locations: utilization.sort((a, b) => b.totalQuantity - a.totalQuantity),
        };

        return stats;
    }

    // 이동 진행 상황 추적
    async getMovementHistory(skuId: string, warehouseId?: string, days: number = 7) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const events = await this.eventStore.getEventHistory(
            skuId,
            warehouseId,
            startDate.toISOString().split('T')[0],
            new Date().toISOString().split('T')[0]
        );

        // 이동 관련 이벤트만 필터링
        const movementEvents = events.filter(e =>
            e.eventType === 'MOVE_INTER_WAREHOUSE' ||
            e.eventType === 'MOVE_INTRA_WAREHOUSE'
        );

        return {
            skuId,
            warehouseId,
            period: `Last ${days} days`,
            totalMovements: movementEvents.length,
            interWarehouseMovements: movementEvents.filter(e => e.eventType === 'MOVE_INTER_WAREHOUSE').length,
            intraWarehouseMovements: movementEvents.filter(e => e.eventType === 'MOVE_INTRA_WAREHOUSE').length,
            movements: movementEvents,
        };
    }
}