// apps/wms/src/inventory/repositories/stock-event.store.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService, TypedDatabase } from '@app/db';
import { eq, and, lte, gte } from 'drizzle-orm';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

// ****************************************************************
// 재고 이벤트 저장소
// 이벤트 소싱 패턴을 위한 이벤트 관리
// ****************************************************************

@Injectable()
export class StockEventStore {
    private readonly logger = new Logger(StockEventStore.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    // 이벤트 생성
    async createEvent(data: {
        type: string;
        skuId: string;
        warehouseId: string;
        locationId?: string;
        deltaQuantity: number;
        relatedStockId?: string;
        reason?: string;
        orderId?: string;
        fromWarehouseId?: string;
        toWarehouseId?: string;
        expiryDate?: Date;
        manufacturedAt?: Date;
        expiresStockRowId?: string;
    }, tx: any) {
        const [event] = await tx.insert(wmsTables.stockEvents).values({
            eventType: data.type,
            skuId: data.skuId,
            warehouseId: data.warehouseId,
            locationId: data.locationId,
            deltaQuantity: data.deltaQuantity,
            relatedStockId: data.relatedStockId,
            reason: data.reason,
            orderId: data.orderId,
            fromWarehouseId: data.fromWarehouseId,
            toWarehouseId: data.toWarehouseId,
            expiryDate: data.expiryDate,
            manufacturedAt: data.manufacturedAt,
            expiresStockRowId: data.expiresStockRowId,
        }).returning();

        this.logger.debug(`Created ${data.type} event for SKU ${data.skuId} with delta ${data.deltaQuantity}`);
        return event;
    }

    // 이벤트 이력 조회
    async getEventHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
        const history = await this.db.query.stockEvents.findMany({
            where: (event, { and, eq, gte, lte }) => and(
                eq(event.skuId, skuId),
                warehouseId ? eq(event.warehouseId, warehouseId) : undefined,
                startDate ? gte(event.eventTimestamp, new Date(startDate)) : undefined,
                endDate ? lte(event.eventTimestamp, new Date(new Date(endDate).setHours(23, 59, 59, 999))) : undefined,
            ),
            orderBy: (event, { asc }) => [asc(event.eventTimestamp)],
        });
        return history;
    }

    // 이벤트 취소
    async cancelStockEvent(eventId: string, reason: string, tx?: DbTx): Promise<void> {
        const execution = async (executor: any) => {
            // 취소할 이벤트 조회
            const originalEvent = await executor.query.stockEvents.findFirst({
                where: eq(wmsTables.stockEvents.id, eventId)
            });

            if (!originalEvent) {
                throw new BadRequestException(`Event ${eventId} not found`);
            }

            // 반대 델타값으로 새 이벤트 생성
            const [cancelEvent] = await executor.insert(wmsTables.stockEvents).values({
                skuId: originalEvent.skuId,
                warehouseId: originalEvent.warehouseId,
                locationId: originalEvent.locationId,
                eventType: 'CANCEL',
                deltaQuantity: -originalEvent.deltaQuantity,
                reason: `Cancel event ${eventId}: ${reason}`,
                orderId: originalEvent.orderId,
                relatedStockId: originalEvent.relatedStockId,
            }).returning();

            // 재고 현황 테이블 업데이트는 StockSummaryRepository에서 처리
            // 이벤트 ID 반환
            this.logger.log(`Event ${eventId} cancelled with reverse delta: ${-originalEvent.deltaQuantity}`);
            return cancelEvent;
        };

        if (tx) {
            return execution(tx);
        } else {
            return this.db.transaction(execution);
        }
    }

    // 특정 시점의 재고 계산
    async calculateStockAtTimestamp(
        skuId: string,
        warehouseId: string,
        timestamp: Date
    ): Promise<number> {
        const events = await this.db.query.stockEvents.findMany({
            where: and(
                eq(wmsTables.stockEvents.skuId, skuId),
                eq(wmsTables.stockEvents.warehouseId, warehouseId),
                lte(wmsTables.stockEvents.eventTimestamp, timestamp)
            ),
            orderBy: (e, { asc }) => [asc(e.eventTimestamp)]
        });

        return events.reduce((sum, event) => sum + event.deltaQuantity, 0);
    }

    // 이벤트 통계 조회
    async getEventStatistics(skuId: string, warehouseId: string, dateRange?: { startDate: Date; endDate: Date }) {
        const conditions = [
            eq(wmsTables.stockEvents.skuId, skuId),
            eq(wmsTables.stockEvents.warehouseId, warehouseId),
        ];

        if (dateRange) {
            conditions.push(
                gte(wmsTables.stockEvents.eventTimestamp, dateRange.startDate),
                lte(wmsTables.stockEvents.eventTimestamp, dateRange.endDate)
            );
        }

        const events = await this.db.query.stockEvents.findMany({
            where: and(...conditions),
        });


        const statistics = events.reduce((acc, event) => {
            if (!acc[event.eventType]) {
                acc[event.eventType] = {
                    count: 0,
                    totalDelta: 0,
                };
            }
            acc[event.eventType].count++;
            acc[event.eventType].totalDelta += event.deltaQuantity;
            return acc;
        }, {} as Record<string, { count: number; totalDelta: number }>);

        return {
            skuId,
            warehouseId,
            totalEvents: events.length,
            netChange: events.reduce((sum, e) => sum + e.deltaQuantity, 0),
            byEventType: statistics,
        };
    }

    // 관련 재고 ID로 이벤트 조회
    async getEventsByRelatedStockId(stockId: string) {
        return this.db.query.stockEvents.findMany({
            where: eq(wmsTables.stockEvents.relatedStockId, stockId),
            orderBy: (e, { desc }) => [desc(e.eventTimestamp)],
        });
    }

    // 최근 이벤트 조회
    async getRecentEvents(limit: number = 100, warehouseId?: string) {
        const conditions = warehouseId
            ? eq(wmsTables.stockEvents.warehouseId, warehouseId)
            : undefined;

        return this.db.query.stockEvents.findMany({
            where: conditions,
            orderBy: (e, { desc }) => [desc(e.eventTimestamp)],
            limit,
            with: {
                sku: true,
                warehouse: true,
            },
        });
    }
}