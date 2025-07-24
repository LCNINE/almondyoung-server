import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { eq, and, isNull } from 'drizzle-orm';
import { CreateStockEntryDto } from '../../inbound/dto/create-stock-entry.dto';
import { SkuCreationSource } from '../dto/sku/create-sku.dto';
import { InventoryService } from './inventory.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { StockSummaryRepository } from '../repositories/ stock-summary.repository';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class StockEventService {
    private readonly logger = new Logger(StockEventService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly inventoryService: InventoryService,
        private readonly eventStore: StockEventStore,
        private readonly summaryRepo: StockSummaryRepository,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    // 재고 입고 처리
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
            reason,
            orderId
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
                    inventoryManagement: inventoryManagement ?? true,
                    source: creationSource,
                }, executor);
            } else {
                if (!sku.inventoryManagement) {
                    throw new BadRequestException(`기존 SKU ${sku.id}는 재고 관리 대상이 아닙니다.`);
                }
            }

            if (quantity < 0) {
                throw new BadRequestException('초기 재고 항목 수량은 음수일 수 없습니다.');
            }

            const event = await this.eventStore.createEvent({
                type: 'IN',
                skuId: sku.id,
                warehouseId,
                locationId,
                deltaQuantity: quantity,
                orderId,
                reason: reason || `initial_stock_creation${variantId ? `_for_variant_${variantId}` : ''}`,
                expiryDate: expiryDate ? new Date(expiryDate) : undefined,
                manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : undefined,
            }, executor);


            await this.summaryRepo.applyDelta(
                sku.id,
                warehouseId,
                quantity,
                'IN',
                event.id,
                executor
            );

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
                creatorEventId: event.id,
            }).returning();

            if (!newStock) {
                throw new Error('새 재고 항목 생성에 실패했습니다.');
            }

            await executor.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, event.id));

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

    // 재고 출고 처리
    async processStockOut(
        stockId: string,
        quantity: number,
        orderId?: string,
        reason?: string
    ) {
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
                    `출고 가능 수량 부족. 요청: ${quantity}, 가능: ${currentStock.availableQuantity}`
                );
            }

            const event = await this.eventStore.createEvent({
                type: orderId ? 'OUT_ORDER' : 'OUT',
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: currentStock.locationId,
                deltaQuantity: -quantity,
                orderId,
                reason: reason || `Stock out${orderId ? ` for order ${orderId}` : ''}`,
                relatedStockId: stockId,
                expiresStockRowId: currentStock.id,
            }, tx);

            await this.summaryRepo.applyDelta(
                currentStock.skuId,
                currentStock.warehouseId,
                -quantity,
                event.eventType,
                event.id,
                tx
            );

            const newRealQuantity = currentStock.realQuantity - quantity;

            if (newRealQuantity === 0) {
                // 재고가 0이 되면 해당 레코드 만료
                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: event.id })
                    .where(eq(wmsTables.stocks.id, stockId));
            } else {
                // 부분 출고인 경우 기존 레코드 만료 후 새 레코드 생성
                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: event.id })
                    .where(eq(wmsTables.stocks.id, stockId));

                const [newStock] = await tx.insert(wmsTables.stocks).values({
                    ...currentStock,
                    id: undefined,
                    creatorEventId: event.id,
                    destroyerEventId: null,
                    realQuantity: newRealQuantity,
                    availableQuantity: currentStock.availableQuantity - quantity,
                }).returning();

                await tx.update(wmsTables.stockEvents)
                    .set({
                        createsStockRowId: newStock.id,
                        relatedStockId: newStock.id
                    })
                    .where(eq(wmsTables.stockEvents.id, event.id));
            }

            this.logger.log(`재고 출고 완료: ${stockId}, 수량: ${quantity}`);
            return event;
        });
    }

    // 재고 예약 처리
    async reserveStock(
        stockId: string,
        quantity: number,
        orderId: string,
        reason?: string
    ) {
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
                    `예약 가능 수량 부족. 요청: ${quantity}, 가능: ${currentStock.availableQuantity}`
                );
            }

            const event = await this.eventStore.createEvent({
                type: 'RESERVE',
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: currentStock.locationId,
                deltaQuantity: 0, // 예약은 재고 수량 변경 없음
                orderId,
                reason: reason || `Stock reservation for order ${orderId}`,
                relatedStockId: stockId,
            }, tx);

            // 재고 현황의 예약 수량 업데이트
            await this.summaryRepo.reserveQuantity(
                currentStock.skuId,
                currentStock.warehouseId,
                quantity,
                event.id,
                tx
            );

            await tx.update(wmsTables.stocks)
                .set({ destroyerEventId: event.id })
                .where(eq(wmsTables.stocks.id, stockId));

            const [newStock] = await tx.insert(wmsTables.stocks).values({
                ...currentStock,
                id: undefined,
                creatorEventId: event.id,
                destroyerEventId: null,
                reservedQuantity: currentStock.reservedQuantity + quantity,
                availableQuantity: currentStock.availableQuantity - quantity,
            }).returning();

            await tx.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, event.id));

            this.logger.log(`재고 예약 완료: ${stockId}, 수량: ${quantity}, 주문: ${orderId}`);
            return newStock;
        });
    }

    // 재고 예약 해제
    async releaseReservation(
        stockId: string,
        quantity: number,
        orderId: string,
        reason?: string
    ) {
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

            if (currentStock.reservedQuantity < quantity) {
                throw new BadRequestException(
                    `예약 해제 수량이 예약된 수량보다 큽니다. 예약: ${currentStock.reservedQuantity}, 해제 요청: ${quantity}`
                );
            }

            const event = await this.eventStore.createEvent({
                type: 'RELEASE_RESERVATION',
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: currentStock.locationId,
                deltaQuantity: 0, // 예약 해제는 재고 수량 변경 없음
                orderId,
                reason: reason || `Release reservation for order ${orderId}`,
                relatedStockId: stockId,
            }, tx);

            await this.summaryRepo.releaseReservation(
                currentStock.skuId,
                currentStock.warehouseId,
                quantity,
                event.id,
                tx
            );

            await tx.update(wmsTables.stocks)
                .set({ destroyerEventId: event.id })
                .where(eq(wmsTables.stocks.id, stockId));

            const [newStock] = await tx.insert(wmsTables.stocks).values({
                ...currentStock,
                id: undefined,
                creatorEventId: event.id,
                destroyerEventId: null,
                reservedQuantity: currentStock.reservedQuantity - quantity,
                availableQuantity: currentStock.availableQuantity + quantity,
            }).returning();

            await tx.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, event.id));

            this.logger.log(`재고 예약 해제 완료: ${stockId}, 수량: ${quantity}, 주문: ${orderId}`);
            return newStock;
        });
    }

    // 창고 간 재고 이동
    async transferBetweenWarehouses(
        stockId: string,
        toWarehouseId: string,
        quantity: number,
        reason?: string
    ) {
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
                    `이동 가능 수량 부족. 요청: ${quantity}, 가능: ${currentStock.availableQuantity}`
                );
            }

            const fromWarehouseId = currentStock.warehouseId;

            // 출고 이벤트 (from warehouse)
            const outEvent = await this.eventStore.createEvent({
                type: 'MOVE_INTER_WAREHOUSE',
                skuId: currentStock.skuId,
                warehouseId: fromWarehouseId,
                locationId: currentStock.locationId,
                deltaQuantity: -quantity,
                fromWarehouseId,
                toWarehouseId,
                reason: reason || `Transfer to warehouse ${toWarehouseId}`,
                relatedStockId: stockId,
                expiresStockRowId: currentStock.id,
            }, tx);

            await this.summaryRepo.applyDelta(
                currentStock.skuId,
                fromWarehouseId,
                -quantity,
                'MOVE_INTER_WAREHOUSE',
                outEvent.id,
                tx
            );

            // 입고 이벤트 (to warehouse)
            const inEvent = await this.eventStore.createEvent({
                type: 'MOVE_INTER_WAREHOUSE',
                skuId: currentStock.skuId,
                warehouseId: toWarehouseId,
                deltaQuantity: quantity,
                fromWarehouseId,
                toWarehouseId,
                reason: reason || `Transfer from warehouse ${fromWarehouseId}`,
                expiryDate: currentStock.expiryDate,
                manufacturedAt: currentStock.manufacturedAt,
            }, tx);

            await this.summaryRepo.applyDelta(
                currentStock.skuId,
                toWarehouseId,
                quantity,
                'MOVE_INTER_WAREHOUSE',
                inEvent.id,
                tx
            );

            // 기존 재고 처리
            const remainingQuantity = currentStock.realQuantity - quantity;

            if (remainingQuantity === 0) {
                // 전체 이동
                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: outEvent.id })
                    .where(eq(wmsTables.stocks.id, stockId));
            } else {
                // 부분 이동 - 기존 재고 업데이트
                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: outEvent.id })
                    .where(eq(wmsTables.stocks.id, stockId));

                const [remainingStock] = await tx.insert(wmsTables.stocks).values({
                    ...currentStock,
                    id: undefined,
                    creatorEventId: outEvent.id,
                    destroyerEventId: null,
                    realQuantity: remainingQuantity,
                    availableQuantity: currentStock.availableQuantity - quantity,
                }).returning();

                await tx.update(wmsTables.stockEvents)
                    .set({ createsStockRowId: remainingStock.id })
                    .where(eq(wmsTables.stockEvents.id, outEvent.id));
            }

            // 새 창고에 재고 생성
            const [newStock] = await tx.insert(wmsTables.stocks).values({
                skuId: currentStock.skuId,
                warehouseId: toWarehouseId,
                stockType: currentStock.stockType,
                realQuantity: quantity,
                reservedQuantity: 0,
                availableQuantity: quantity,
                safetyStock: currentStock.safetyStock,
                creatorEventId: inEvent.id,
                expiryDate: currentStock.expiryDate,
                manufacturedAt: currentStock.manufacturedAt,
                barcodeType: currentStock.barcodeType,
                subBarcode: currentStock.subBarcode,
                packingUnit: currentStock.packingUnit,
            }).returning();

            await tx.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, inEvent.id));

            this.logger.log(
                `재고 이동 완료: ${stockId}, 수량: ${quantity}, ` +
                `${fromWarehouseId} → ${toWarehouseId}`
            );

            return {
                outEvent,
                inEvent,
                newStock,
            };
        });
    }

    // 재고 손실 처리
    async processDamage(
        stockId: string,
        quantity: number,
        reason: string
    ) {
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
                    `손실 처리 가능 수량 부족. 요청: ${quantity}, 가능: ${currentStock.availableQuantity}`
                );
            }

            const event = await this.eventStore.createEvent({
                type: 'OUT_DAMAGE',
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: currentStock.locationId,
                deltaQuantity: -quantity,
                reason: `Damage: ${reason}`,
                relatedStockId: stockId,
                expiresStockRowId: currentStock.id,
            }, tx);

            await this.summaryRepo.applyDelta(
                currentStock.skuId,
                currentStock.warehouseId,
                -quantity,
                'OUT_DAMAGE',
                event.id,
                tx
            );

            const remainingQuantity = currentStock.realQuantity - quantity;

            if (remainingQuantity === 0) {
                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: event.id })
                    .where(eq(wmsTables.stocks.id, stockId));
            } else {
                await tx.update(wmsTables.stocks)
                    .set({ destroyerEventId: event.id })
                    .where(eq(wmsTables.stocks.id, stockId));

                const [newStock] = await tx.insert(wmsTables.stocks).values({
                    ...currentStock,
                    id: undefined,
                    creatorEventId: event.id,
                    destroyerEventId: null,
                    realQuantity: remainingQuantity,
                    availableQuantity: currentStock.availableQuantity - quantity,
                }).returning();

                await tx.update(wmsTables.stockEvents)
                    .set({
                        createsStockRowId: newStock.id,
                        relatedStockId: newStock.id
                    })
                    .where(eq(wmsTables.stockEvents.id, event.id));
            }

            this.logger.log(`재고 손실 처리 완료: ${stockId}, 수량: ${quantity}, 사유: ${reason}`);
            return event;
        });
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
        return this.db.transaction(async (tx) => {
            const event = await this.eventStore.createEvent({
                type: 'IN_RETURN',
                skuId,
                warehouseId,
                locationId,
                deltaQuantity: quantity,
                orderId,
                reason: reason || `Return from order ${orderId}`,
            }, tx);

            await this.summaryRepo.applyDelta(
                skuId,
                warehouseId,
                quantity,
                'IN_RETURN',
                event.id,
                tx
            );

            const [newStock] = await tx.insert(wmsTables.stocks).values({
                skuId,
                warehouseId,
                locationId,
                stockType: 'physical',
                realQuantity: quantity,
                reservedQuantity: 0,
                availableQuantity: quantity,
                creatorEventId: event.id,
            }).returning();

            await tx.update(wmsTables.stockEvents)
                .set({
                    createsStockRowId: newStock.id,
                    relatedStockId: newStock.id
                })
                .where(eq(wmsTables.stockEvents.id, event.id));

            this.logger.log(`반품 처리 완료: SKU ${skuId}, 수량: ${quantity}, 주문: ${orderId}`);
            return newStock;
        });
    }
}