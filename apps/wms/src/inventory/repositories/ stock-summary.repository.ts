import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { STOCK_RULES, applyRule, createInitialState } from '../rules/stock-update.rules';
import { EventType, StockUpdateData } from '../rules/stock-rule.types';

// ****************************************************************
// 재고 현황 저장소
// 이중 원장의 현재 상태 관리
// ****************************************************************

@Injectable()
export class StockSummaryRepository {
    private readonly logger = new Logger(StockSummaryRepository.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    // SKU와 창고별 재고 현황 조회
    async findBySkuAndWarehouse(skuId: string, warehouseId: string) {
        return this.db.query.stockSummary.findFirst({
            where: and(
                eq(wmsTables.stockSummary.skuId, skuId),
                eq(wmsTables.stockSummary.warehouseId, warehouseId)
            ),
        });
    }

    // 델타값 적용하여 재고 현황 업데이트
    async applyDelta(
        skuId: string,
        warehouseId: string,
        deltaQuantity: number,
        eventType: string,
        eventId: string,
        tx: any,
        additionalContext?: { fromWarehouseId?: string; toWarehouseId?: string }
    ): Promise<void> {
        const existing = await tx.query.stockSummary.findFirst({
            where: and(
                eq(wmsTables.stockSummary.skuId, skuId),
                eq(wmsTables.stockSummary.warehouseId, warehouseId)
            ),
        });

        if (existing) {
            // Rule 기반 계산
            const rule = STOCK_RULES[eventType as EventType];
            if (!rule) {
                this.logger.warn(`Unknown event type: ${eventType}, using default rule`);
            }

            const updateData = applyRule(
                {
                    existing: existing as StockUpdateData,
                    delta: deltaQuantity,
                    eventType: eventType as EventType,
                    ...additionalContext
                },
                rule || { fields: { currentQuantity: '+', availableQuantity: '+' } },
                { onNegative: 'log-and-clamp' }
            );

            const result = await tx.update(wmsTables.stockSummary)
                .set({
                    ...updateData,
                    lastEventId: eventId,
                    lastUpdated: new Date(),
                    version: existing.version + 1,
                })
                .where(and(
                    eq(wmsTables.stockSummary.skuId, skuId),
                    eq(wmsTables.stockSummary.warehouseId, warehouseId),
                    eq(wmsTables.stockSummary.version, existing.version)
                ))
                .returning();

            if (result.length === 0) {
                throw new Error('Concurrent update detected. Please retry.');
            }

            this.logger.debug(
                `Updated stock summary for SKU ${skuId} in warehouse ${warehouseId}: ` +
                `currentQuantity ${existing.currentQuantity} → ${updateData.currentQuantity}`
            );
        } else {
            await this._createNew(skuId, warehouseId, deltaQuantity, eventType as EventType, eventId, tx);
        }
    }

    // 재고 현황 재구축 (이벤트 소싱으로부터)
    async rebuild(skuId: string, warehouseId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            const events = await tx.query.stockEvents.findMany({
                where: and(
                    eq(wmsTables.stockEvents.skuId, skuId),
                    eq(wmsTables.stockEvents.warehouseId, warehouseId)
                ),
                orderBy: (e, { asc }) => [asc(e.eventTimestamp)]
            });

            let state = createInitialState();

            for (const event of events) {
                const rule = STOCK_RULES[event.eventType as EventType];
                if (rule) {
                    const updates = applyRule(
                        {
                            existing: state,
                            delta: event.deltaQuantity,
                            eventType: event.eventType as EventType,
                            fromWarehouseId: event.fromWarehouseId ?? undefined,
                            toWarehouseId: event.toWarehouseId ?? undefined
                        },
                        rule,
                        { onNegative: 'clamp' }
                    );

                    Object.assign(state, updates);
                } else {
                    this.logger.warn(`No rule found for event type: ${event.eventType}`);

                    state.currentQuantity += event.deltaQuantity;
                    state.availableQuantity += event.deltaQuantity;
                }
            }

            // 예약 수량은 stocks 테이블에서 별도 계산
            const activeStocks = await tx.query.stocks.findMany({
                where: and(
                    eq(wmsTables.stocks.skuId, skuId),
                    eq(wmsTables.stocks.warehouseId, warehouseId),
                    eq(wmsTables.stocks.destroyerEventId, null)
                ),
            });

            state.reservedQuantity = activeStocks.reduce((sum, stock) => sum + stock.reservedQuantity, 0);
            state.availableQuantity = Math.max(0, state.currentQuantity - state.reservedQuantity);

            await tx.delete(wmsTables.stockSummary)
                .where(and(
                    eq(wmsTables.stockSummary.skuId, skuId),
                    eq(wmsTables.stockSummary.warehouseId, warehouseId)
                ));

            if (state.currentQuantity > 0 || events.length > 0) {
                const lastEvent = events[events.length - 1];

                await tx.insert(wmsTables.stockSummary).values({
                    skuId,
                    warehouseId,
                    ...state,
                    lastEventId: lastEvent?.id,
                    version: 1,
                });
            }

            this.logger.log(`Stock summary rebuilt for SKU ${skuId} in warehouse ${warehouseId}`);
        });
    }

    // 일괄 재고 현황 조회
    async findBulk(filters: { skuIds?: string[]; warehouseIds?: string[] }) {
        const conditions: any[] = [];

        if (filters.skuIds?.length) {
            conditions.push(inArray(wmsTables.stockSummary.skuId, filters.skuIds));
        }

        if (filters.warehouseIds?.length) {
            conditions.push(inArray(wmsTables.stockSummary.warehouseId, filters.warehouseIds));
        }

        return this.db.query.stockSummary.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
            with: {
                sku: true,
                warehouse: true,
            },
        });
    }

    // 재고 예약 처리
    async reserveQuantity(
        skuId: string,
        warehouseId: string,
        quantity: number,
        eventId: string,
        tx: any
    ): Promise<void> {
        const summary = await this.findBySkuAndWarehouse(skuId, warehouseId);
        if (!summary) {
            throw new Error(`Stock summary not found for SKU ${skuId} in warehouse ${warehouseId}`);
        }

        if (summary.availableQuantity < quantity) {
            throw new Error(`Insufficient available quantity. Required: ${quantity}, Available: ${summary.availableQuantity}`);
        }

        await tx.update(wmsTables.stockSummary)
            .set({
                reservedQuantity: summary.reservedQuantity + quantity,
                availableQuantity: summary.availableQuantity - quantity,
                lastEventId: eventId,
                lastUpdated: new Date(),
                version: summary.version + 1,
            })
            .where(and(
                eq(wmsTables.stockSummary.skuId, skuId),
                eq(wmsTables.stockSummary.warehouseId, warehouseId),
                eq(wmsTables.stockSummary.version, summary.version)
            ));
    }

    // 재고 예약 해제 처리
    async releaseReservation(
        skuId: string,
        warehouseId: string,
        quantity: number,
        eventId: string,
        tx: any
    ): Promise<void> {
        const summary = await this.findBySkuAndWarehouse(skuId, warehouseId);
        if (!summary) {
            throw new Error(`Stock summary not found for SKU ${skuId} in warehouse ${warehouseId}`);
        }

        await tx.update(wmsTables.stockSummary)
            .set({
                reservedQuantity: Math.max(0, summary.reservedQuantity - quantity),
                availableQuantity: summary.availableQuantity + quantity,
                lastEventId: eventId,
                lastUpdated: new Date(),
                version: summary.version + 1,
            })
            .where(and(
                eq(wmsTables.stockSummary.skuId, skuId),
                eq(wmsTables.stockSummary.warehouseId, warehouseId),
                eq(wmsTables.stockSummary.version, summary.version)
            ));
    }

    // 새 재고 현황 생성
    private async _createNew(
        skuId: string,
        warehouseId: string,
        deltaQuantity: number,
        eventType: EventType,
        eventId: string,
        tx: any
    ) {
        const initialState = createInitialState();

        const rule = STOCK_RULES[eventType];
        if (rule) {
            const updates = applyRule(
                {
                    existing: initialState,
                    delta: deltaQuantity,
                    eventType
                },
                rule,
                { onNegative: 'clamp' }
            );
            Object.assign(initialState, updates);
        } else {
            this.logger.warn(`No rule found for event type: ${eventType}, applying default`);
            initialState.currentQuantity = Math.max(0, deltaQuantity);
            initialState.availableQuantity = Math.max(0, deltaQuantity);
        }

        await tx.insert(wmsTables.stockSummary).values({
            skuId,
            warehouseId,
            ...initialState,
            lastEventId: eventId,
            version: 1,
        });

        this.logger.debug(
            `Created new stock summary for SKU ${skuId} in warehouse ${warehouseId} ` +
            `with initial quantity ${initialState.currentQuantity}`
        );
    }

    // 재고 현황 통계 조회
    async getStatistics(warehouseId?: string) {
        const conditions = warehouseId
            ? eq(wmsTables.stockSummary.warehouseId, warehouseId)
            : undefined;

        const summaries = await this.db.query.stockSummary.findMany({
            where: conditions,
        });

        return {
            totalSkus: summaries.length,
            totalQuantity: summaries.reduce((sum, s) => sum + s.currentQuantity, 0),
            totalAvailable: summaries.reduce((sum, s) => sum + s.availableQuantity, 0),
            totalReserved: summaries.reduce((sum, s) => sum + s.reservedQuantity, 0),
            totalInboundPending: summaries.reduce((sum, s) => sum + s.inboundPendingQuantity, 0),
            totalOutboundPending: summaries.reduce((sum, s) => sum + s.outboundPendingQuantity, 0),
            totalMoving: summaries.reduce((sum, s) => sum + s.movingQuantity, 0),
            totalDamage: summaries.reduce((sum, s) => sum + s.damageQuantity, 0),
            totalReturnPending: summaries.reduce((sum, s) => sum + s.returnPendingQuantity, 0),
        };
    }

    // 재고 부족 SKU 조회
    async findLowStockSkus(threshold: number = 10, warehouseId?: string) {
        const conditions: any[] = [
            sql`${wmsTables.stockSummary.availableQuantity} < ${threshold}`
        ];

        if (warehouseId) {
            conditions.push(eq(wmsTables.stockSummary.warehouseId, warehouseId));
        }

        return this.db.query.stockSummary.findMany({
            where: and(...conditions),
            with: {
                sku: true,
                warehouse: true,
            },
            orderBy: (s, { asc }) => [asc(s.availableQuantity)],
        });
    }
}