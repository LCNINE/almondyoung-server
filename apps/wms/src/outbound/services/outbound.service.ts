import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService, TypedDatabase } from '@app/db';
import { and, eq, isNull, gte, inArray, sql } from 'drizzle-orm';
import { InventoryService } from '../../inventory/services/inventory.service';
import { StockEventStore } from '../../inventory/repositories/stock-event.store';
import { StockSummaryRepository } from '../../inventory/repositories/ stock-summary.repository';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class OutboundService {
    private readonly logger = new Logger(OutboundService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly inventoryService: InventoryService,
        private readonly eventStore: StockEventStore,
        private readonly summaryRepo: StockSummaryRepository,
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

            // 출고 이벤트 생성 - 이벤트 스토어 사용
            const outboundEvent = await this.eventStore.createEvent({
                type: orderId ? 'OUT_ORDER' : 'OUT',
                skuId: currentStock.skuId,
                warehouseId: currentStock.warehouseId,
                locationId: currentStock.locationId,
                deltaQuantity: -quantity,
                orderId,
                relatedStockId: currentStock.id,
                reason: `출고 - ${reason}`,
                expiresStockRowId: currentStock.id,
            }, tx);

            // 재고 현황 업데이트 - Repository 사용
            await this.summaryRepo.applyDelta(
                currentStock.skuId,
                currentStock.warehouseId,
                -quantity,
                outboundEvent.eventType,
                outboundEvent.id,
                tx
            );

            // 3. 재고 레코드 처리
            await tx.update(wmsTables.stocks)
                .set({ destroyerEventId: outboundEvent.id })
                .where(eq(wmsTables.stocks.id, stockId));

            const remainingQuantity = currentStock.realQuantity - quantity;
            let newStockId: string | null = null;

            if (remainingQuantity > 0) {
                // 부분 출고 - 남은 재고 생성
                const [newStock] = await tx.insert(wmsTables.stocks).values({
                    ...currentStock,
                    id: undefined,
                    creatorEventId: outboundEvent.id,
                    destroyerEventId: null,
                    realQuantity: remainingQuantity,
                    availableQuantity: currentStock.availableQuantity - quantity,
                }).returning();

                newStockId = newStock.id;

                await tx.update(wmsTables.stockEvents)
                    .set({
                        createsStockRowId: newStock.id,
                        relatedStockId: newStock.id
                    })
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
                remainingStockId: newStockId,
                orderId,
            };
        });
    }

    // 주문들로부터 출고 작업 생성
    async createOutboundTaskFromOrders(orderIds: string[]) {
        return this.db.transaction(async (tx) => {
            const orders = await tx.query.orders.findMany({
                where: and(
                    inArray(wmsTables.orders.id, orderIds),
                    eq(wmsTables.orders.status, 'confirmed')
                ),
            });

            if (orders.length === 0) {
                throw new NotFoundException('확정된 주문을 찾을 수 없습니다.');
            }

            const orderIdList = orders.map(order => order.id);
            const orderItems = await tx.query.orderItems.findMany({
                where: sql`${wmsTables.orderItems.orderId} = ANY(${orderIdList})`,
            });

            const productMatchingIds = orderItems.map(item => item.productMatchingId).filter(id => id);
            const productMatchings = await tx.query.productMatchings.findMany({
                where: sql`${wmsTables.productMatchings.id} = ANY(${productMatchingIds})`,
            });

            const productMatchingIds2 = productMatchings.map(pm => pm.id);
            const productVariantSkuLinks = await tx.query.productVariantSkuLinks.findMany({
                where: sql`${wmsTables.productVariantSkuLinks.productMatchingId} = ANY(${productMatchingIds2})`,
            });


            const orderItemsMap = new Map();
            orderItems.forEach(item => {
                if (!orderItemsMap.has(item.orderId)) {
                    orderItemsMap.set(item.orderId, []);
                }
                orderItemsMap.get(item.orderId).push(item);
            });

            const productMatchingsMap = new Map(productMatchings.map(pm => [pm.id, pm]));
            const skuLinksMap = new Map();
            productVariantSkuLinks.forEach(link => {
                if (!skuLinksMap.has(link.productMatchingId)) {
                    skuLinksMap.set(link.productMatchingId, []);
                }
                skuLinksMap.get(link.productMatchingId).push(link);
            });

            // 창고별로 그룹화
            const warehouseGroups: Record<string, typeof orders> = {};

            for (const order of orders) {
                const orderItemsForOrder = orderItemsMap.get(order.id) || [];
                const firstItem = orderItemsForOrder[0];

                if (!firstItem?.productMatchingId) {
                    continue;
                }

                const skuLinks = skuLinksMap.get(firstItem.productMatchingId) || [];
                if (skuLinks.length === 0) {
                    continue;
                }

                const firstSkuId = skuLinks[0].skuId;
                const stockSummary = await tx.query.stockSummary.findFirst({
                    where: and(
                        eq(wmsTables.stockSummary.skuId, firstSkuId),
                        gte(wmsTables.stockSummary.availableQuantity, 1)
                    ),
                });

                const warehouseId = stockSummary?.warehouseId || this.inventoryService.getDefaultWarehouseId();

                if (!warehouseGroups[warehouseId]) {
                    warehouseGroups[warehouseId] = [];
                }
                warehouseGroups[warehouseId].push(order);
            }

            // 창고별로 출고 작업 생성
            const tasks: any[] = [];

            for (const [warehouseId, warehouseOrders] of Object.entries(warehouseGroups)) {
                // 합배송 그룹 확인
                const mergeGroupId = warehouseOrders[0]?.mergeGroupId;

                const [task] = await tx.insert(wmsTables.outboundTasks).values({
                    warehouseId,
                    mergeGroupId,
                    status: 'created',
                    priority: 'normal',
                    totalItems: 0,
                    totalQuantity: 0,
                }).returning();

                // 주문 연결
                for (const order of warehouseOrders) {
                    await tx.insert(wmsTables.outboundTaskOrders).values({
                        taskId: task.id,
                        orderId: order.id,
                    });
                }

                // SKU별 수량 집계
                const skuQuantities: Record<string, number> = {};

                for (const order of warehouseOrders) {
                    const orderItemsForOrder = orderItemsMap.get(order.id) || [];
                    for (const item of orderItemsForOrder) {
                        if (item.productMatchingId) {
                            const skuLinks = skuLinksMap.get(item.productMatchingId) || [];
                            for (const link of skuLinks) {
                                const skuId = link.skuId;
                                const quantity = item.quantity * link.quantity;
                                skuQuantities[skuId] = (skuQuantities[skuId] || 0) + quantity;
                            }
                        }
                    }
                }

                // 출고 작업 아이템 생성
                let totalItems = 0;
                let totalQuantity = 0;

                for (const [skuId, quantity] of Object.entries(skuQuantities)) {
                    await tx.insert(wmsTables.outboundTaskItems).values({
                        taskId: task.id,
                        skuId,
                        quantityPending: quantity,
                        quantityPicking: 0,
                        quantityPicked: 0,
                    });

                    totalItems++;
                    totalQuantity += quantity;
                }

                // 작업 총계 업데이트
                await tx.update(wmsTables.outboundTasks)
                    .set({
                        totalItems,
                        totalQuantity,
                    })
                    .where(eq(wmsTables.outboundTasks.id, task.id));

                tasks.push({
                    ...task,
                    totalItems,
                    totalQuantity,
                    orderCount: warehouseOrders.length,
                });
            }

            this.logger.log(`출고 작업 생성 완료: ${tasks.length}개 작업, 총 ${orders.length}개 주문`);

            return tasks;
        });
    }

    // 피킹 리스트 생성
    async generatePickingList(taskId: string) {
        const task = await this.db.query.outboundTasks.findFirst({
            where: eq(wmsTables.outboundTasks.id, taskId),
        });

        if (!task) {
            throw new NotFoundException(`출고 작업 ${taskId}를 찾을 수 없습니다.`);
        }

        const taskItems = await this.db.query.outboundTaskItems.findMany({
            where: eq(wmsTables.outboundTaskItems.taskId, taskId),
        });

        const skuIds = taskItems.map(item => item.skuId);
        const skus = await this.db.query.skus.findMany({
            where: sql`${wmsTables.skus.id} = ANY(${skuIds})`,
        });

        const skuMap = new Map(skus.map(sku => [sku.id, sku]));

        const pickingList: any[] = [];

        for (const item of taskItems) {
            const pendingQuantity = item.quantityPending - item.quantityPicking - item.quantityPicked;

            if (pendingQuantity <= 0) continue;

            // 재고 위치별 가용 수량 조회
            const stocks = await this.db.query.stocks.findMany({
                where: and(
                    eq(wmsTables.stocks.skuId, item.skuId),
                    eq(wmsTables.stocks.warehouseId, task.warehouseId),
                    isNull(wmsTables.stocks.destroyerEventId),
                    gte(wmsTables.stocks.availableQuantity, 1)
                ),
                orderBy: (stocks, { asc }) => [
                    asc(stocks.expiryDate),
                    asc(stocks.creatorEventId),
                ],
            });

            const locationIds = stocks.map(stock => stock.locationId).filter(id => id);
            const locations = await this.db.query.locations.findMany({
                where: sql`${wmsTables.locations.id} = ANY(${locationIds})`,
            });

            const locationMap = new Map(locations.map(location => [location.id, location]));

            let remainingQuantity = pendingQuantity;
            const pickLocations: any[] = [];

            for (const stock of stocks) {
                if (remainingQuantity <= 0) break;

                const pickQuantity = Math.min(stock.availableQuantity, remainingQuantity);
                const location = stock.locationId ? locationMap.get(stock.locationId) : null;

                pickLocations.push({
                    stockId: stock.id,
                    locationId: stock.locationId,
                    locationCode: location?.code || 'N/A',
                    quantity: pickQuantity,
                    expiryDate: stock.expiryDate,
                });

                remainingQuantity -= pickQuantity;
            }

            const sku = skuMap.get(item.skuId);
            pickingList.push({
                skuId: item.skuId,
                skuCode: sku?.code,
                skuName: sku?.name,
                requestedQuantity: pendingQuantity,
                locations: pickLocations,
                shortageQuantity: remainingQuantity > 0 ? remainingQuantity : 0,
            });
        }

        pickingList.sort((a, b) => {
            const aLocation = a.locations[0]?.locationCode || 'ZZZ';
            const bLocation = b.locations[0]?.locationCode || 'ZZZ';
            return aLocation.localeCompare(bLocation);
        });

        return {
            taskId,
            warehouseId: task.warehouseId,
            status: task.status,
            totalItems: pickingList.length,
            totalQuantity: pickingList.reduce((sum, item) => sum + item.requestedQuantity, 0),
            pickingList,
        };
    }

    // 출고 작업 상태 업데이트
    async updateTaskStatus(taskId: string, status: 'picking' | 'packed' | 'shipped' | 'canceled') {
        const task = await this.db.query.outboundTasks.findFirst({
            where: eq(wmsTables.outboundTasks.id, taskId),
        });

        if (!task) {
            throw new NotFoundException(`출고 작업 ${taskId}를 찾을 수 없습니다.`);
        }

        const validTransitions: Record<string, string[]> = {
            created: ['picking', 'canceled'],
            picking: ['packed', 'canceled'],
            packed: ['shipped', 'canceled'],
            shipped: [],
            canceled: [],
        };

        if (!validTransitions[task.status]?.includes(status)) {
            throw new BadRequestException(
                `${task.status} 상태에서 ${status} 상태로 변경할 수 없습니다.`
            );
        }

        await this.db.update(wmsTables.outboundTasks)
            .set({
                status,
                updatedAt: new Date(),
            })
            .where(eq(wmsTables.outboundTasks.id, taskId));

        // shipped 상태가 되면 관련 주문도 업데이트
        if (status === 'shipped') {
            const taskOrders = await this.db.query.outboundTaskOrders.findMany({
                where: eq(wmsTables.outboundTaskOrders.taskId, taskId),
            });

            const orderIds = taskOrders.map(to => to.orderId);

            await this.db.update(wmsTables.orders)
                .set({
                    status: 'shipped',
                    processedAt: new Date(),
                })
                .where(inArray(wmsTables.orders.id, orderIds));
        }

        this.logger.log(`출고 작업 ${taskId} 상태 변경: ${task.status} → ${status}`);

        return { taskId, previousStatus: task.status, newStatus: status };
    }

    // 출고 실적 조회
    async getOutboundStatistics(warehouseId?: string, days: number = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // 이벤트 기반 통계
        const events = await this.eventStore.getEventHistory(
            '',
            warehouseId,
            startDate.toISOString().split('T')[0],
            new Date().toISOString().split('T')[0]
        );

        const outboundEvents = events.filter(e =>
            e.eventType === 'OUT' ||
            e.eventType === 'OUT_ORDER' ||
            e.eventType === 'OUT_DAMAGE' ||
            e.eventType === 'OUT_LOSS' ||
            e.eventType === 'OUT_DISPOSAL'
        );

        // 일별 집계
        const dailyStats: Record<string, { quantity: number; events: number; orders: Set<string> }> = {};

        outboundEvents.forEach(event => {
            const date = new Date(event.eventTimestamp).toISOString().split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = { quantity: 0, events: 0, orders: new Set() };
            }
            dailyStats[date].quantity += Math.abs(event.deltaQuantity);
            dailyStats[date].events += 1;
            if (event.orderId) {
                dailyStats[date].orders.add(event.orderId);
            }
        });

        return {
            period: `Last ${days} days`,
            totalOutboundQuantity: outboundEvents.reduce((sum, e) => sum + Math.abs(e.deltaQuantity), 0),
            totalOutboundEvents: outboundEvents.length,
            orderOutbounds: outboundEvents.filter(e => e.eventType === 'OUT_ORDER').length,
            damageOutbounds: outboundEvents.filter(e => e.eventType === 'OUT_DAMAGE').length,
            lossOutbounds: outboundEvents.filter(e => e.eventType === 'OUT_LOSS').length,
            disposalOutbounds: outboundEvents.filter(e => e.eventType === 'OUT_DISPOSAL').length,
            dailyStats: Object.entries(dailyStats).map(([date, stats]) => ({
                date,
                quantity: stats.quantity,
                events: stats.events,
                orders: stats.orders.size,
            })),
        };
    }
}