import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { eq, and, sql, inArray } from 'drizzle-orm';

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
        tx: any
    ): Promise<void> {
        const existing = await tx.query.stockSummary.findFirst({
            where: and(
                eq(wmsTables.stockSummary.skuId, skuId),
                eq(wmsTables.stockSummary.warehouseId, warehouseId)
            ),
        });

        if (existing) {
            const updateData = this._calculateUpdate(existing, deltaQuantity, eventType);

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
            await this._createNew(skuId, warehouseId, deltaQuantity, eventType, eventId, tx);
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

            let currentQuantity = 0;
            let inboundPendingQuantity = 0;
            let outboundPendingQuantity = 0;
            let damageQuantity = 0;
            let returnPendingQuantity = 0;
            let movingQuantity = 0;

            for (const event of events) {
                currentQuantity += event.deltaQuantity;

                switch (event.eventType) {
                    case 'IN':
                    case 'IN_DOMESTIC':
                    case 'IN_OVERSEAS':
                        // 입고 이벤트 - 입고 대기 수량이 있다면 감소
                        if (event.reason?.includes('pending')) {
                            inboundPendingQuantity = Math.max(0, inboundPendingQuantity - event.deltaQuantity);
                        }
                        break;
                    case 'IN_RETURN':
                        // 반품 입고 - 반품 대기 수량 감소
                        returnPendingQuantity = Math.max(0, returnPendingQuantity - event.deltaQuantity);
                        break;
                    case 'OUT':
                    case 'OUT_ORDER':
                        // 출고 이벤트 - 출고 대기 수량이 있다면 감소
                        if (event.reason?.includes('pending')) {
                            outboundPendingQuantity = Math.max(0, outboundPendingQuantity - Math.abs(event.deltaQuantity));
                        }
                        break;
                    case 'OUT_DAMAGE':
                    case 'OUT_LOSS':
                    case 'OUT_DISPOSAL':
                        damageQuantity += Math.abs(event.deltaQuantity);
                        break;
                    case 'MOVE_INTER_WAREHOUSE':
                        if (event.deltaQuantity < 0) {
                            // 출고 창고에서는 이동 중 수량 증가
                            movingQuantity += Math.abs(event.deltaQuantity);
                        } else if (event.fromWarehouseId === warehouseId) {
                            // 입고 창고에서는 이동 중 수량 감소
                            movingQuantity = Math.max(0, movingQuantity - event.deltaQuantity);
                        }
                        break;
                    case 'RESERVE':
                        // 예약 이벤트는 별도로 처리 (stocks 테이블에서 계산)
                        break;
                    case 'RELEASE':
                        // 예약 해제 이벤트는 별도로 처리
                        break;
                }
            }


            const activeStocks = await tx.query.stocks.findMany({
                where: and(
                    eq(wmsTables.stocks.skuId, skuId),
                    eq(wmsTables.stocks.warehouseId, warehouseId),
                    eq(wmsTables.stocks.destroyerEventId, null)
                ),
            });

            const reservedQuantity = activeStocks.reduce((sum, stock) => sum + stock.reservedQuantity, 0);

            await tx.delete(wmsTables.stockSummary)
                .where(and(
                    eq(wmsTables.stockSummary.skuId, skuId),
                    eq(wmsTables.stockSummary.warehouseId, warehouseId)
                ));

            if (currentQuantity > 0 || events.length > 0) {
                const lastEvent = events[events.length - 1];

                await tx.insert(wmsTables.stockSummary).values({
                    skuId,
                    warehouseId,
                    currentQuantity: Math.max(0, currentQuantity),
                    availableQuantity: Math.max(0, currentQuantity - reservedQuantity),
                    reservedQuantity: reservedQuantity,
                    inboundPendingQuantity: inboundPendingQuantity,
                    outboundPendingQuantity: outboundPendingQuantity,
                    movingQuantity: movingQuantity,
                    damageQuantity: damageQuantity,
                    returnPendingQuantity: returnPendingQuantity,
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

    // 재고 현황 업데이트 계산
    private _calculateUpdate(existing: any, deltaQuantity: number, eventType: string) {
        const update: any = {};

        switch (eventType) {
            // 입고 계열 (재고 증가)
            case 'IN':
            case 'IN_DOMESTIC':
            case 'IN_OVERSEAS':
                update.currentQuantity = existing.currentQuantity + deltaQuantity;
                update.availableQuantity = existing.availableQuantity + deltaQuantity;
                // 입고 대기 수량이 있다면 감소
                break;

            case 'IN_RETURN':
                update.currentQuantity = existing.currentQuantity + deltaQuantity;
                update.availableQuantity = existing.availableQuantity + deltaQuantity;
                update.returnPendingQuantity = Math.max(0, existing.returnPendingQuantity - deltaQuantity);
                break;

            // 출고 계열 (재고 감소)
            case 'OUT':
            case 'OUT_ORDER':
                update.currentQuantity = existing.currentQuantity + deltaQuantity;
                update.availableQuantity = existing.availableQuantity + deltaQuantity;
                // 출고 대기 수량이 있다면 감소
                break;

            case 'OUT_DAMAGE':
            case 'OUT_LOSS':
            case 'OUT_DISPOSAL':
                update.currentQuantity = existing.currentQuantity + deltaQuantity;
                update.availableQuantity = existing.availableQuantity + deltaQuantity;
                update.damageQuantity = existing.damageQuantity + Math.abs(deltaQuantity);
                break;

            // 이동 계열
            case 'MOVE_INTER_WAREHOUSE':
                if (deltaQuantity < 0) {
                    // 출고 창고
                    update.currentQuantity = existing.currentQuantity + deltaQuantity;
                    update.availableQuantity = existing.availableQuantity + deltaQuantity;
                    update.movingQuantity = existing.movingQuantity + Math.abs(deltaQuantity);
                } else {
                    // 입고 창고
                    update.currentQuantity = existing.currentQuantity + deltaQuantity;
                    update.availableQuantity = existing.availableQuantity + deltaQuantity;
                    update.movingQuantity = Math.max(0, existing.movingQuantity - deltaQuantity);
                }
                break;

            // 조정 계열
            case 'ADJUST':
            case 'ADJUST_MANUAL':
            case 'ADJUST_INVENTORY':
                update.currentQuantity = existing.currentQuantity + deltaQuantity;
                update.availableQuantity = existing.availableQuantity + deltaQuantity;
                break;

            // 예약 계열 (수량 변경 없음, 예약 수량만 변경)
            case 'RESERVE':
            case 'CONFIRM':
            case 'RELEASE':
                // 예약은 별도 메서드에서 처리 (reserveQuantity, releaseReservation)
                update.currentQuantity = existing.currentQuantity;
                update.availableQuantity = existing.availableQuantity;
                break;

            // 취소
            case 'CANCEL':
                // 반대 델타값이 이미 적용되어 있으므로 단순 업데이트
                update.currentQuantity = existing.currentQuantity + deltaQuantity;
                update.availableQuantity = existing.availableQuantity + deltaQuantity;
                break;

            default:
                this.logger.warn(`Unknown event type: ${eventType}`);
                update.currentQuantity = existing.currentQuantity + deltaQuantity;
                update.availableQuantity = existing.availableQuantity + deltaQuantity;
        }

        // 음수 방지
        Object.keys(update).forEach(key => {
            if (typeof update[key] === 'number' && update[key] < 0) {
                this.logger.warn(`Negative value prevented for ${key}: ${update[key]}`);
                update[key] = 0;
            }
        });

        return update;
    }

    // 새 재고 현황 생성
    private async _createNew(
        skuId: string,
        warehouseId: string,
        deltaQuantity: number,
        eventType: string,
        eventId: string,
        tx: any
    ) {
        const initialData: any = {
            skuId,
            warehouseId,
            currentQuantity: 0,
            availableQuantity: 0,
            reservedQuantity: 0,
            inboundPendingQuantity: 0,
            outboundPendingQuantity: 0,
            movingQuantity: 0,
            damageQuantity: 0,
            returnPendingQuantity: 0,
            lastEventId: eventId,
            version: 1,
        };

        // 초기값 설정
        switch (eventType) {
            case 'IN':
            case 'IN_DOMESTIC':
            case 'IN_OVERSEAS':
                initialData.currentQuantity = Math.max(0, deltaQuantity);
                initialData.availableQuantity = Math.max(0, deltaQuantity);
                break;
            case 'RESERVE':
                // 예약은 수량 변경 없이 예약 정보만 설정
                initialData.reservedQuantity = deltaQuantity;
                break;
            default:
                // 일반적으로 첫 이벤트가 음수인 경우는 없어야 함
                if (deltaQuantity < 0) {
                    this.logger.error(`First event has negative delta: ${deltaQuantity}`);
                }
                initialData.currentQuantity = Math.max(0, deltaQuantity);
                initialData.availableQuantity = Math.max(0, deltaQuantity);
        }

        await tx.insert(wmsTables.stockSummary).values(initialData);

        this.logger.debug(
            `Created new stock summary for SKU ${skuId} in warehouse ${warehouseId} ` +
            `with initial quantity ${initialData.currentQuantity}`
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