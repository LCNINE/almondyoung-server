// apps/wms/src/movement/services/movement.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { InterWarehouseTransferDto } from '../dto/inter-warehouse-transfer.dto';
import { IntraWarehouseMoveDto } from '../dto/intra-warehouse-move.dto';

@Injectable()
export class MovementService {
    private readonly logger = new Logger(MovementService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
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
            // 출발 창고의 재고 현황 확인
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

            // 실제 재고 레코드 조회 (FIFO)
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

                // 출고 이벤트 (음수 델타값)
                const [outEvent] = await tx.insert(wmsTables.stockEvents).values({
                    relatedStockId: sourceStock.id, // stockId -> relatedStockId
                    skuId: sourceStock.skuId,
                    warehouseId: fromWarehouseId,
                    fromWarehouseId: fromWarehouseId,
                    toWarehouseId: toWarehouseId,
                    eventType: 'MOVE_INTER_WAREHOUSE',
                    deltaQuantity: -transferQuantity, // quantity -> deltaQuantity (음수)
                    reason: `창고 이동: ${fromWarehouseId} → ${toWarehouseId} - ${reason}`,
                    expiresStockRowId: sourceStock.id,
                }).returning();

                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: outEvent.id })
                    .where(eq(wmsTables.stocks.id, sourceStock.id));

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

            // 2. 재고 현황 테이블 업데이트 - 출발 창고
            const outResult = await tx.update(wmsTables.stockSummary)
                .set({
                    currentQuantity: fromSummary.currentQuantity - quantity, // totalQuantity -> currentQuantity
                    availableQuantity: fromSummary.availableQuantity - quantity,
                    movingQuantity: fromSummary.movingQuantity + quantity, // 이동 중 수량 증가
                    lastEventId: transferDetails[0] ? wmsTables.stockEvents.id : fromSummary.lastEventId,
                    lastUpdated: new Date(),
                    version: fromSummary.version + 1,
                })
                .where(and(
                    eq(wmsTables.stockSummary.skuId, skuId),
                    eq(wmsTables.stockSummary.warehouseId, fromWarehouseId),
                    eq(wmsTables.stockSummary.version, fromSummary.version)
                ))
                .returning();

            if (outResult.length === 0) {
                throw new Error('Concurrent update detected on source warehouse. Please retry.');
            }

            // 3. 도착 창고에 입고 처리
            const inEventIds: string[] = [];
            for (const detail of transferDetails) {
                // 입고 이벤트 (양수 델타값)
                const [inEvent] = await tx.insert(wmsTables.stockEvents).values({
                    skuId,
                    warehouseId: toWarehouseId,
                    fromWarehouseId: fromWarehouseId,
                    toWarehouseId: toWarehouseId,
                    eventType: 'MOVE_INTER_WAREHOUSE',
                    deltaQuantity: detail.transferQuantity, // quantity -> deltaQuantity (양수)
                    expiryDate: detail.expiryDate,
                    manufacturedAt: detail.manufacturedAt,
                    reason: `창고 이동: ${fromWarehouseId} → ${toWarehouseId} - ${reason}`,
                }).returning();

                inEventIds.push(inEvent.id);

                const [newStock] = await tx.insert(wmsTables.stocks).values({
                    skuId,
                    warehouseId: toWarehouseId,
                    locationId: null,
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
                        relatedStockId: newStock.id // stockId -> relatedStockId
                    })
                    .where(eq(wmsTables.stockEvents.id, inEvent.id));
            }

            // 4. 재고 현황 테이블 업데이트 - 도착 창고
            const toSummary = await tx.query.stockSummary.findFirst({
                where: and(
                    eq(wmsTables.stockSummary.skuId, skuId),
                    eq(wmsTables.stockSummary.warehouseId, toWarehouseId)
                ),
            });

            if (toSummary) {
                const inResult = await tx.update(wmsTables.stockSummary)
                    .set({
                        currentQuantity: toSummary.currentQuantity + quantity, // totalQuantity -> currentQuantity
                        availableQuantity: toSummary.availableQuantity + quantity,
                        movingQuantity: Math.max(0, toSummary.movingQuantity - quantity), // 이동 중 수량 감소
                        lastEventId: inEventIds[inEventIds.length - 1] || toSummary.lastEventId,
                        lastUpdated: new Date(),
                        version: toSummary.version + 1,
                    })
                    .where(and(
                        eq(wmsTables.stockSummary.skuId, skuId),
                        eq(wmsTables.stockSummary.warehouseId, toWarehouseId),
                        eq(wmsTables.stockSummary.version, toSummary.version)
                    ))
                    .returning();

                if (inResult.length === 0) {
                    throw new Error('Concurrent update detected on destination warehouse. Please retry.');
                }
            } else {
                await tx.insert(wmsTables.stockSummary).values({
                    skuId,
                    warehouseId: toWarehouseId,
                    currentQuantity: quantity, // totalQuantity -> currentQuantity
                    availableQuantity: quantity,
                    reservedQuantity: 0,
                    inboundPendingQuantity: 0,
                    outboundPendingQuantity: 0,
                    movingQuantity: 0,
                    damageQuantity: 0,
                    returnPendingQuantity: 0, // returnQuantity -> returnPendingQuantity
                    lastEventId: inEventIds[inEventIds.length - 1],
                    version: 1,
                });
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

            const [moveEvent] = await tx.insert(wmsTables.stockEvents).values({
                relatedStockId: currentStock.id,
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                eventType: 'MOVE_INTRA_WAREHOUSE',
                deltaQuantity: 0,
                locationId: newLocationId,
                reason: `위치 이동: ${currentStock.locationId || 'N/A'} → ${newLocationId} - ${reason}`,
                expiresStockRowId: currentStock.id,
            }).returning();

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
                .set({ createsStockRowId: newStock.id })
                .where(eq(wmsTables.stockEvents.id, moveEvent.id));

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
                };
            })
        );

        return utilization;
    }

    // TODO: 이동 작업 생성 메서드

    // TODO: 이동 진행 상황 추적 메서드
}