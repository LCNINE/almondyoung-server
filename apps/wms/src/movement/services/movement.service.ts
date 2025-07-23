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

            if (!sourceStocks.length) {
                throw new NotFoundException(`출발 창고에 SKU ${skuId}의 가용 재고가 없습니다.`);
            }

            const totalAvailable = sourceStocks.reduce((sum, stock) => sum + stock.availableQuantity, 0);
            if (totalAvailable < quantity) {
                throw new BadRequestException(
                    `가용 재고(${totalAvailable})가 이동 수량(${quantity})보다 적습니다.`
                );
            }

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

            for (const detail of transferDetails) {
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
                stockId: currentStock.id,
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                eventType: 'MOVE_INTRA_WAREHOUSE',
                quantity: 0,
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