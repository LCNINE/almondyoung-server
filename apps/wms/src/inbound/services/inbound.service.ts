import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService, TypedDatabase } from '@app/db';
import { and, eq, sql, gte, lte, desc } from 'drizzle-orm';
import { InventoryService } from '../../inventory/services/inventory.service';
import { InventoryCommandService } from '../../inventory/services/inventory-command.service';
import { LocationService } from '../../inventory/services/location.service';
import { StockEventStore } from '../../inventory/repositories/stock-event.store';
import { SimpleInboundDto, IndividualInboundDto, UpdateInboundLineMemoDto } from '../dto/simple-inbound.dto';
import { CancelInboundDto, PutawayRequestDto, ReturnInboundDto, CreateInboundPlanDto, AddInboundPlanItemsDto, ReceiveFromPlanDto, ListPlanItemsQueryDto } from '../dto/simple-inbound.dto';
import { isSameSeoulDay, nowSeoul } from '../../shared/services/time.util';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class InboundService {
    private readonly logger = new Logger(InboundService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly inventoryService: InventoryService,
        private readonly commandService: InventoryCommandService,
        private readonly locationService: LocationService,
        private readonly eventStore: StockEventStore,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
        return tx ? fn(tx) : this.db.transaction(fn);
    }

    // 입고 라인 메모 수정
    async updateInboundLineMemo(lineId: string, dto: UpdateInboundLineMemoDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const line = await tx.query.inboundReceiptLines.findFirst({
                where: eq(wmsTables.inboundReceiptLines.id, lineId),
            });
            if (!line) throw new NotFoundException('inbound line not found');
            await tx.update(wmsTables.inboundReceiptLines)
                .set({ memo: dto.memo })
                .where(eq(wmsTables.inboundReceiptLines.id, lineId));
            return { success: true };
        }, tx);
    }

    private async getOnHandQuantity(
        tx: DbTx,
        params: { skuId: string; warehouseId: string; locationId: string }
    ): Promise<number> {
        const row = await tx.query.stockLedgers.findFirst({
            where: and(
                eq(wmsTables.stockLedgers.skuId, params.skuId),
                eq(wmsTables.stockLedgers.warehouseId, params.warehouseId),
                eq(wmsTables.stockLedgers.locationId, params.locationId),
                eq(wmsTables.stockLedgers.stockState as any, 'ON_HAND' as any),
            ),
        });
        return (row?.qty as number) ?? 0;
    }

    // 간편입고: 지정 창고/로케이션에 여러 SKU를 즉시 입고
    async simpleInbound(dto: SimpleInboundDto, tx?: DbTx) {
        const { warehouseId, items } = dto;
        return this.inTx(async (tx) => {
            // 간편입고는 항상 시스템 입고기본존으로 (보장 선행)
            await this.locationService.ensureSystemLocations(warehouseId);
            const inboundZone = await this.locationService.getSystemLocationByRole(warehouseId, 'inbound_default');
            if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
            const effectiveLocationId = inboundZone.id;
            // 회차(journal + receipt) 생성
            const [journal] = await tx.insert(wmsTables.stockJournals).values({
                sourceType: 'inbound',
                occurredAt: new Date(),
            } as any).returning();

            const [receipt] = await tx.insert(wmsTables.inboundReceipts).values({
                method: 'simple',
                warehouseId,
                locationId: effectiveLocationId,
                occurredAt: new Date(),
                status: 'posted',
                totalQuantity: 0,
                journalId: journal.id,
            } as any).returning();

            let totalQty = 0;
            for (const item of items) {
                const sku = await this.inventoryService.findSkuById(item.skuId, tx);
                if (!sku) throw new NotFoundException(`SKU ${item.skuId} not found`);

                const { eventId } = await this.commandService.receive({
                    skuId: item.skuId,
                    toWarehouseId: warehouseId,
                    toLocationId: effectiveLocationId,
                    quantity: item.quantity,
                    occurredAt: new Date(),
                    reason: 'simple_inbound',
                    journalId: journal.id,
                }, tx);

                await tx.insert(wmsTables.inboundReceiptLines).values({
                    receiptId: receipt.id,
                    skuId: item.skuId,
                    quantity: item.quantity,
                    originLocationId: effectiveLocationId,
                    eventId: eventId ?? null,
                    memo: item.memo,
                } as any);

                totalQty += item.quantity;
            }

            await tx.update(wmsTables.inboundReceipts)
                .set({ totalQuantity: totalQty })
                .where(eq(wmsTables.inboundReceipts.id, receipt.id));

            // 작업 로그 기록 (회차 레벨)
            await tx.insert(wmsTables.inboundWorkLogs).values({
                type: 'INBOUND',
                receiptId: receipt.id,
                warehouseId,
                toLocationId: effectiveLocationId,
                quantity: totalQty,
                method: 'simple',
                reason: 'simple_inbound',
            } as any);

            return { success: true, count: items.length, receiptId: receipt.id, totalQuantity: totalQty };
        }, tx);
    }

    // 전수조사 간편입고: 처리 로직은 동일하나 회차/로그의 method를 구분
    async simpleInboundFullscan(dto: SimpleInboundDto, tx?: DbTx) {
        const { warehouseId, items } = dto;
        return this.inTx(async (tx) => {
            await this.locationService.ensureSystemLocations(warehouseId);
            const inboundZone = await this.locationService.getSystemLocationByRole(warehouseId, 'inbound_default');
            if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
            const effectiveLocationId = inboundZone.id;

            const [journal] = await tx.insert(wmsTables.stockJournals).values({
                sourceType: 'inbound',
                occurredAt: new Date(),
            } as any).returning();

            const [receipt] = await tx.insert(wmsTables.inboundReceipts).values({
                method: 'simple_fullscan',
                warehouseId,
                locationId: effectiveLocationId,
                occurredAt: new Date(),
                status: 'posted',
                totalQuantity: 0,
                journalId: journal.id,
            } as any).returning();

            let totalQty = 0;
            for (const item of items) {
                const sku = await this.inventoryService.findSkuById(item.skuId, tx);
                if (!sku) throw new NotFoundException(`SKU ${item.skuId} not found`);
                const { eventId } = await this.commandService.receive({
                    skuId: item.skuId,
                    toWarehouseId: warehouseId,
                    toLocationId: effectiveLocationId,
                    quantity: item.quantity,
                    occurredAt: new Date(),
                    reason: 'simple_inbound_fullscan',
                    journalId: journal.id,
                }, tx);
                await tx.insert(wmsTables.inboundReceiptLines).values({
                    receiptId: receipt.id,
                    skuId: item.skuId,
                    quantity: item.quantity,
                    originLocationId: effectiveLocationId,
                    eventId: eventId ?? null,
                    memo: item.memo,
                } as any);
                totalQty += item.quantity;
            }
            await tx.update(wmsTables.inboundReceipts)
                .set({ totalQuantity: totalQty })
                .where(eq(wmsTables.inboundReceipts.id, receipt.id));
            await tx.insert(wmsTables.inboundWorkLogs).values({
                type: 'INBOUND',
                receiptId: receipt.id,
                warehouseId,
                toLocationId: effectiveLocationId,
                quantity: totalQty,
                method: 'simple_fullscan',
                reason: 'simple_inbound_fullscan',
            } as any);
            return { success: true, count: items.length, receiptId: receipt.id, totalQuantity: totalQty };
        }, tx);
    }

    // 개별입고: 단일 SKU를 지정 로케이션(옵션, 없으면 기본입고존)으로 입고
    async individualInbound(dto: IndividualInboundDto, tx?: DbTx) {
        const { warehouseId, skuId, quantity } = dto;
        return this.inTx(async (tx) => {
            let effectiveLocationId = dto.locationId ?? null;
            if (!effectiveLocationId) {
                await this.locationService.ensureSystemLocations(warehouseId);
                const inboundZone = await this.locationService.getSystemLocationByRole(warehouseId, 'inbound_default');
                if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
                effectiveLocationId = inboundZone.id;
            }

            const [journal] = await tx.insert(wmsTables.stockJournals).values({
                sourceType: 'inbound',
                occurredAt: new Date(),
            } as any).returning();

            const [receipt] = await tx.insert(wmsTables.inboundReceipts).values({
                method: 'individual',
                warehouseId,
                locationId: effectiveLocationId,
                occurredAt: new Date(),
                status: 'posted',
                totalQuantity: 0,
                journalId: journal.id,
            } as any).returning();

            const sku = await this.inventoryService.findSkuById(skuId, tx);
            if (!sku) throw new NotFoundException(`SKU ${skuId} not found`);

            const { eventId } = await this.commandService.receive({
                skuId,
                toWarehouseId: warehouseId,
                toLocationId: effectiveLocationId,
                quantity,
                occurredAt: new Date(),
                reason: 'individual_inbound',
                journalId: journal.id,
            }, tx);

            await tx.insert(wmsTables.inboundReceiptLines).values({
                receiptId: receipt.id,
                skuId,
                quantity,
                originLocationId: effectiveLocationId,
                eventId: eventId ?? null,
                memo: dto.memo,
            } as any);

            await tx.update(wmsTables.inboundReceipts)
                .set({ totalQuantity: quantity })
                .where(eq(wmsTables.inboundReceipts.id, receipt.id));

            await tx.insert(wmsTables.inboundWorkLogs).values({
                type: 'INBOUND',
                receiptId: receipt.id,
                warehouseId,
                toLocationId: effectiveLocationId,
                quantity,
                method: 'individual',
                reason: 'individual_inbound',
            } as any);

            return { success: true, receiptId: receipt.id };
        }, tx);
    }
    // 레거시 제거: processInbound/createStockEntry 삭제

    // 입고 예정 목록 조회
    async getInboundPending(warehouseId?: string, tx?: DbTx) {
        // 구매 주문 중 아직 입고되지 않은 항목 조회
        const pendingPOs = await this.db.query.purchaseOrders.findMany({
            where: eq(wmsTables.purchaseOrders.status, 'confirmed'),
        });

        // 창고별 필터링
        const filtered = warehouseId
            ? pendingPOs.filter(po => {
                // 해외 거래처면 해외 창고, 국내는 국내 창고
                const expectedWarehouse = po.type === 'foreign'
                    ? this.inventoryService.getDefaultWarehouseIdByType('overseas')
                    : this.inventoryService.getDefaultWarehouseIdByType('domestic');
                return expectedWarehouse === warehouseId;
            })
            : pendingPOs;

        const poIds = filtered.map(po => po.id);
        const supplierIds = filtered.map(po => po.supplierId).filter(id => id);

        const purchaseOrderLines = await this.db.query.purchaseOrderLines.findMany({
            where: sql`${wmsTables.purchaseOrderLines.poId} = ANY(${poIds})`,
        });

        const skuIds = purchaseOrderLines.map(line => line.skuId);
        const skus = await this.db.query.skus.findMany({
            where: sql`${wmsTables.skus.id} = ANY(${skuIds})`,
        });

        const suppliers = await this.db.query.suppliers.findMany({
            where: sql`${wmsTables.suppliers.id} = ANY(${supplierIds})`,
        });

        const skuMap = new Map(skus.map(sku => [sku.id, sku]));
        const supplierMap = new Map(suppliers.map(supplier => [supplier.id, supplier]));

        const inboundPending = filtered.map(po => {
            const poLines = purchaseOrderLines.filter(line => line.poId === po.id);
            const supplier = po.supplierId ? supplierMap.get(po.supplierId) : null;

            return {
                purchaseOrderId: po.id,
                supplierName: supplier?.name || 'Unknown',
                type: po.type,
                expectedArrival: po.expectedArrival,
                items: poLines.map(line => {
                    const sku = skuMap.get(line.skuId);
                    return {
                        skuId: line.skuId,
                        skuName: sku?.name || 'Unknown',
                        skuCode: sku?.code || 'Unknown',
                        quantity: line.quantity,
                        unitPrice: line.unitPrice,
                    };
                }),
                totalQuantity: poLines.reduce((sum, line) => sum + line.quantity, 0),
                totalValue: poLines.reduce((sum, line) => sum + (line.quantity * (line.unitPrice || 0)), 0),
            };
        });

        return {
            warehouseId,
            totalPendingOrders: inboundPending.length,
            totalPendingQuantity: inboundPending.reduce((sum, po) => sum + po.totalQuantity, 0),
            pendingOrders: inboundPending,
        };
    }

    // 입고내역(현황) 조회 - (sku, quantity, occurredAt, method)
    async listInboundReceipts(params: {
        skuId?: string; warehouseId?: string; method?: 'individual'|'simple'|'simple_fullscan'|'planned';
        startDate?: string; endDate?: string; limit?: number; offset?: number;
    }, tx?: DbTx) {
        const { skuId, warehouseId, method, startDate, endDate, limit = 50, offset = 0 } = params;

        const rows = await this.db
            .select({
                receiptId: wmsTables.inboundReceipts.id,
                method: wmsTables.inboundReceipts.method,
                occurredAt: wmsTables.inboundReceipts.occurredAt,
                warehouseId: wmsTables.inboundReceipts.warehouseId,
                locationId: wmsTables.inboundReceipts.locationId,
                skuId: wmsTables.inboundReceiptLines.skuId,
                quantity: wmsTables.inboundReceiptLines.quantity,
            })
            .from(wmsTables.inboundReceipts)
            .leftJoin(
                wmsTables.inboundReceiptLines,
                eq(wmsTables.inboundReceiptLines.receiptId, wmsTables.inboundReceipts.id),
            )
            .where(and(
                eq(wmsTables.inboundReceipts.status as any, 'posted' as any),
                warehouseId ? eq(wmsTables.inboundReceipts.warehouseId, warehouseId) : undefined,
                method ? eq(wmsTables.inboundReceipts.method as any, method as any) : undefined,
                skuId ? eq(wmsTables.inboundReceiptLines.skuId, skuId) : undefined,
                startDate ? gte(wmsTables.inboundReceipts.occurredAt, new Date(startDate)) : undefined,
                endDate ? lte(wmsTables.inboundReceipts.occurredAt, new Date(new Date(endDate).setHours(23,59,59,999))) : undefined,
            ))
            .orderBy(desc(wmsTables.inboundReceipts.occurredAt))
            .limit(limit)
            .offset(offset);

        return { total: rows.length, items: rows };
    }

    // 입고 작업 타임라인 조회
    async listInboundWorkLogs(params: {
        warehouseId?: string; skuId?: string; type?: 'INBOUND'|'PUTAWAY'|'RETURN'|'CANCEL'; method?: 'individual'|'simple'|'simple_fullscan'|'planned';
        startDate?: string; endDate?: string; limit?: number; offset?: number;
    }, tx?: DbTx) {
        const { warehouseId, skuId, type, method, startDate, endDate, limit = 100, offset = 0 } = params;

        const logs = await this.db
            .select({
                id: wmsTables.inboundWorkLogs.id,
                type: wmsTables.inboundWorkLogs.type,
                timestamp: wmsTables.inboundWorkLogs.timestamp,
                receiptId: wmsTables.inboundWorkLogs.receiptId,
                lineId: wmsTables.inboundWorkLogs.lineId,
                planItemId: wmsTables.inboundWorkLogs.planItemId,
                skuId: wmsTables.inboundWorkLogs.skuId,
                warehouseId: wmsTables.inboundWorkLogs.warehouseId,
                fromLocationId: wmsTables.inboundWorkLogs.fromLocationId,
                toLocationId: wmsTables.inboundWorkLogs.toLocationId,
                quantity: wmsTables.inboundWorkLogs.quantity,
                method: wmsTables.inboundWorkLogs.method,
                reason: wmsTables.inboundWorkLogs.reason,
                eventId: wmsTables.inboundWorkLogs.eventId,
            })
            .from(wmsTables.inboundWorkLogs)
            .where(and(
                warehouseId ? eq(wmsTables.inboundWorkLogs.warehouseId, warehouseId) : undefined,
                skuId ? eq(wmsTables.inboundWorkLogs.skuId, skuId) : undefined,
                type ? eq(wmsTables.inboundWorkLogs.type as any, type as any) : undefined,
                method ? eq(wmsTables.inboundWorkLogs.method as any, method as any) : undefined,
                startDate ? gte(wmsTables.inboundWorkLogs.timestamp, new Date(startDate)) : undefined,
                endDate ? lte(wmsTables.inboundWorkLogs.timestamp, new Date(new Date(endDate).setHours(23,59,59,999))) : undefined,
            ))
            .orderBy(desc(wmsTables.inboundWorkLogs.timestamp))
            .limit(limit)
            .offset(offset);

        return { total: logs.length, items: logs };
    }

    // 집계 입고현황: 라인 단위 결과 + 확정수량(취소/회송 반영)
    async listInboundStatus(params: {
        skuId?: string; warehouseId?: string; startDate?: string; endDate?: string; limit?: number; offset?: number;
    }, tx?: DbTx) {
        const { skuId, warehouseId, startDate, endDate, limit = 50, offset = 0 } = params;

        const rows = await this.db
            .select({
                receiptId: wmsTables.inboundReceipts.id,
                lineId: wmsTables.inboundReceiptLines.id,
                occurredAt: wmsTables.inboundReceipts.occurredAt,
                method: wmsTables.inboundReceipts.method,
                warehouseId: wmsTables.inboundReceipts.warehouseId,
                locationId: wmsTables.inboundReceipts.locationId,
                skuId: wmsTables.inboundReceiptLines.skuId,
                qtyReceived: wmsTables.inboundReceiptLines.quantity,
                qtyReturned: wmsTables.inboundReceiptLines.returnedQty,
            })
            .from(wmsTables.inboundReceipts)
            .leftJoin(
                wmsTables.inboundReceiptLines,
                eq(wmsTables.inboundReceiptLines.receiptId, wmsTables.inboundReceipts.id),
            )
            .where(and(
                eq(wmsTables.inboundReceipts.status as any, 'posted' as any),
                warehouseId ? eq(wmsTables.inboundReceipts.warehouseId, warehouseId) : undefined,
                skuId ? eq(wmsTables.inboundReceiptLines.skuId, skuId) : undefined,
                startDate ? gte(wmsTables.inboundReceipts.occurredAt, new Date(startDate)) : undefined,
                endDate ? lte(wmsTables.inboundReceipts.occurredAt, new Date(new Date(endDate).setHours(23,59,59,999))) : undefined,
            ))
            .orderBy(desc(wmsTables.inboundReceipts.occurredAt))
            .limit(limit)
            .offset(offset);

        const items = rows
            .map(r => {
                const confirmed = Math.max(0, (r.qtyReceived ?? 0) - (r.qtyReturned ?? 0));
                return { ...r, confirmedQty: confirmed };
            })
            .filter(r => r.confirmedQty > 0);

        return { total: items.length, items };
    }

    // 입고예정 생성
    async createInboundPlan(dto: CreateInboundPlanDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const [plan] = await tx.insert(wmsTables.inboundPlans).values({
                expectedDate: new Date(dto.expectedDate),
                warehouseId: dto.warehouseId,
                status: 'pending',
            } as any).returning();
            return plan;
        }, tx);
    }

    // 입고예정 아이템 추가
    async addInboundPlanItems(dto: AddInboundPlanItemsDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const plan = await tx.query.inboundPlans.findFirst({ where: eq(wmsTables.inboundPlans.id, dto.planId) });
            if (!plan) throw new NotFoundException('inbound plan not found');
            for (const item of dto.items) {
                await tx.insert(wmsTables.inboundPlanItems).values({
                    planId: dto.planId,
                    skuId: item.skuId,
                    expectedQty: item.expectedQty,
                    receivedQty: 0,
                    status: 'pending',
                } as any);
            }
            return { success: true };
        }, tx);
    }

    // 입고예정 아이템 조회(헤더 무시, 아이템 테이블 직접 조회)
    async listInboundPlanItems(query: ListPlanItemsQueryDto, tx?: DbTx) {
        const { startDate, endDate, warehouseId, skuId } = query;
        const rows = await this.db
            .select({
                planItemId: wmsTables.inboundPlanItems.id,
                planId: wmsTables.inboundPlanItems.planId,
                expectedDate: wmsTables.inboundPlans.expectedDate,
                warehouseId: wmsTables.inboundPlans.warehouseId,
                skuId: wmsTables.inboundPlanItems.skuId,
                expectedQty: wmsTables.inboundPlanItems.expectedQty,
                receivedQty: wmsTables.inboundPlanItems.receivedQty,
                status: wmsTables.inboundPlanItems.status,
            })
            .from(wmsTables.inboundPlanItems)
            .leftJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlans.id, wmsTables.inboundPlanItems.planId))
            .where(and(
                warehouseId ? eq(wmsTables.inboundPlans.warehouseId, warehouseId) : undefined,
                skuId ? eq(wmsTables.inboundPlanItems.skuId, skuId) : undefined,
                startDate ? gte(wmsTables.inboundPlans.expectedDate, new Date(startDate)) : undefined,
                endDate ? lte(wmsTables.inboundPlans.expectedDate, new Date(new Date(endDate).setHours(23,59,59,999))) : undefined,
            ))
            .orderBy(desc(wmsTables.inboundPlans.expectedDate));
        return { total: rows.length, items: rows };
    }

    // 입고예정 아이템 기반 실입고 처리
    async receiveFromPlan(dto: ReceiveFromPlanDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const item = await tx.query.inboundPlanItems.findFirst({ where: eq(wmsTables.inboundPlanItems.id, dto.planItemId) });
            if (!item) throw new NotFoundException('inbound plan item not found');
            const plan = await tx.query.inboundPlans.findFirst({ where: eq(wmsTables.inboundPlans.id, item.planId) });
            if (!plan) throw new NotFoundException('inbound plan not found');

            // 위치 결정 (옵션, 없으면 기본입고존)
            let effectiveLocationId = dto.locationId ?? null;
            if (!effectiveLocationId) {
                await this.locationService.ensureSystemLocations(plan.warehouseId);
                const inboundZone = await this.locationService.getSystemLocationByRole(plan.warehouseId, 'inbound_default');
                if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
                effectiveLocationId = inboundZone.id;
            }

            // 회차(journal + receipt) 생성
            const [journal] = await tx.insert(wmsTables.stockJournals).values({
                sourceType: 'inbound',
                occurredAt: new Date(),
            } as any).returning();
            const [receipt] = await tx.insert(wmsTables.inboundReceipts).values({
                method: 'planned',
                warehouseId: plan.warehouseId,
                locationId: effectiveLocationId,
                occurredAt: new Date(),
                status: 'posted',
                totalQuantity: 0,
                journalId: journal.id,
            } as any).returning();

            // 이벤트 생성 + 라인 생성
            const { eventId } = await this.commandService.receive({
                skuId: item.skuId,
                toWarehouseId: plan.warehouseId,
                toLocationId: effectiveLocationId,
                quantity: dto.quantity,
                occurredAt: new Date(),
                reason: 'planned_inbound',
                journalId: journal.id,
            }, tx);
            await tx.insert(wmsTables.inboundReceiptLines).values({
                receiptId: receipt.id,
                skuId: item.skuId,
                quantity: dto.quantity,
                originLocationId: effectiveLocationId,
                eventId: eventId ?? null,
                planItemId: item.id,
            } as any);

            // 예정 누계/상태 갱신
            const newReceived = (item.receivedQty ?? 0) + dto.quantity;
            const newStatus = newReceived >= item.expectedQty ? 'confirmed' : 'pending';
            await tx.update(wmsTables.inboundPlanItems)
                .set({ receivedQty: newReceived, status: newStatus as any })
                .where(eq(wmsTables.inboundPlanItems.id, item.id));

            await tx.update(wmsTables.inboundReceipts)
                .set({ totalQuantity: dto.quantity })
                .where(eq(wmsTables.inboundReceipts.id, receipt.id));

            await tx.insert(wmsTables.inboundWorkLogs).values({
                type: 'INBOUND',
                receiptId: receipt.id,
                lineId: null as any,
                skuId: item.skuId,
                warehouseId: plan.warehouseId,
                toLocationId: effectiveLocationId,
                quantity: dto.quantity,
                method: 'planned',
                reason: 'planned_inbound',
            } as any);

            return { success: true, receiptId: receipt.id };
        }, tx);
    }

    // 즉시 적치(원위치 → 목적지)
    async putawayFromOrigin(dto: PutawayRequestDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const line = await tx.query.inboundReceiptLines.findFirst({
                where: eq(wmsTables.inboundReceiptLines.id, dto.lineId),
            });
            if (!line) throw new NotFoundException('inbound line not found');

            const receipt = await tx.query.inboundReceipts.findFirst({
                where: eq(wmsTables.inboundReceipts.id, line.receiptId),
            });
            if (!receipt) throw new NotFoundException('inbound receipt not found');

            const originLocationId = line.originLocationId!;
            if (!originLocationId) throw new BadRequestException('origin location missing');

            // 목적지 로케이션 검증: 존재/활성/동일 창고
            const dest = await tx.query.locations.findFirst({
                where: eq(wmsTables.locations.id, dto.toLocationId),
            });
            if (!dest) throw new NotFoundException('destination location not found');
            if (!dest.isActive) throw new BadRequestException('destination location is inactive');
            if (dest.warehouseId !== receipt.warehouseId) throw new BadRequestException('destination location must be in the same warehouse');

            const originAvailable = (line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty);
            if (dto.quantity <= 0 || dto.quantity > originAvailable) {
                throw new BadRequestException('quantity exceeds origin available');
            }

            // 실원장 검증: 원위치 ON_HAND 수량 확인
            const onHand = await this.getOnHandQuantity(tx, {
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                locationId: originLocationId,
            });
            if (onHand < dto.quantity) {
                throw new BadRequestException('insufficient on-hand at origin');
            }

            // 이동: 예약 → 커밋 (즉시)
            await this.commandService.moveReserve({
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                fromLocationId: originLocationId,
                quantity: dto.quantity,
                reason: 'putaway_reserve',
            }, tx);
            const commit = await this.commandService.moveCommit({
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                fromLocationId: originLocationId,
                toLocationId: dto.toLocationId,
                quantity: dto.quantity,
                reason: 'putaway_commit',
            }, tx);

            await tx.update(wmsTables.inboundReceiptLines)
                .set({ putawayFromOriginQty: line.putawayFromOriginQty + dto.quantity })
                .where(eq(wmsTables.inboundReceiptLines.id, line.id));

            await tx.insert(wmsTables.inboundWorkLogs).values({
                type: 'PUTAWAY',
                receiptId: receipt.id,
                lineId: line.id,
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                fromLocationId: originLocationId,
                toLocationId: dto.toLocationId,
                quantity: dto.quantity,
                eventId: commit.eventId ?? null,
            } as any);

            return { success: true };
        }, tx);
    }

    // 회송
    async returnInbound(dto: ReturnInboundDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const line = await tx.query.inboundReceiptLines.findFirst({
                where: eq(wmsTables.inboundReceiptLines.id, dto.lineId),
            });
            if (!line) throw new NotFoundException('inbound line not found');
            const receipt = await tx.query.inboundReceipts.findFirst({
                where: eq(wmsTables.inboundReceipts.id, line.receiptId),
            });
            if (!receipt) throw new NotFoundException('inbound receipt not found');
            const originLocationId = line.originLocationId!;
            // 선행 제약: 적치가 존재하면 회송 불가 (원위치로 모두 되돌린 후 처리)
            if ((line.putawayFromOriginQty ?? 0) > 0) {
                throw new BadRequestException('cannot return: putaway exists; move all back to origin first');
            }
            const originAvailable = (line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty);
            if (dto.quantity <= 0 || dto.quantity > originAvailable) {
                throw new BadRequestException('quantity exceeds origin available');
            }

            // 실원장 검증: 원위치 ON_HAND 수량 확인
            const onHand = await this.getOnHandQuantity(tx, {
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                locationId: originLocationId,
            });
            if (onHand < dto.quantity) {
                throw new BadRequestException('insufficient on-hand at origin');
            }

            const event = await this.eventStore.createEvent({
                skuId: line.skuId,
                fromWarehouseId: receipt.warehouseId,
                fromLocationId: originLocationId,
                fromState: 'ON_HAND',
                transitionType: 'RECEIPT_CORRECTION_DOWN',
                quantity: dto.quantity,
                occurredAt: new Date(),
                reason: 'RETURN',
            }, tx);

            await tx.update(wmsTables.inboundReceiptLines)
                .set({ returnedQty: line.returnedQty + dto.quantity })
                .where(eq(wmsTables.inboundReceiptLines.id, line.id));

            await tx.insert(wmsTables.inboundWorkLogs).values({
                type: 'RETURN',
                receiptId: receipt.id,
                lineId: line.id,
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                fromLocationId: originLocationId,
                quantity: dto.quantity,
                reason: 'RETURN',
                eventId: event?.id ?? null,
            } as any);

            return { success: true };
        }, tx);
    }

    // 입고취소
    async cancelInbound(dto: CancelInboundDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const line = await tx.query.inboundReceiptLines.findFirst({
                where: eq(wmsTables.inboundReceiptLines.id, dto.lineId),
            });
            if (!line) throw new NotFoundException('inbound line not found');
            const receipt = await tx.query.inboundReceipts.findFirst({
                where: eq(wmsTables.inboundReceipts.id, line.receiptId),
            });
            if (!receipt) throw new NotFoundException('inbound receipt not found');
            const originLocationId = line.originLocationId!;

            // 전량 취소만 허용
            if (dto.quantity !== line.quantity) {
                throw new BadRequestException('must cancel the full received quantity of the line');
            }

            // 선행 제약: 적치/회송 존재 시 취소 불가
            if ((line.putawayFromOriginQty ?? 0) > 0) {
                throw new BadRequestException('cannot cancel: putaway exists; move all back to origin first');
            }
            if ((line.returnedQty ?? 0) > 0) {
                throw new BadRequestException('cannot cancel: returns exist; cancel returns first');
            }
            if ((line.canceledQty ?? 0) > 0) {
                throw new BadRequestException('already canceled');
            }

            // 당일 제한(Asia/Seoul 기준)
            const receiptRow = await tx.query.inboundReceipts.findFirst({
                where: eq(wmsTables.inboundReceipts.id, line.receiptId),
            });
            if (!receiptRow) throw new NotFoundException('inbound receipt not found');
            if (!isSameSeoulDay(nowSeoul(), receiptRow.occurredAt as any)) {
                throw new BadRequestException('cancel is allowed only on the same day (Asia/Seoul)');
            }

            // 실원장 검증: 원위치 ON_HAND가 전량 있어야 함
            const onHand = await this.getOnHandQuantity(tx, {
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                locationId: originLocationId,
            });
            if (onHand < line.quantity) {
                throw new BadRequestException('insufficient on-hand at origin to cancel');
            }

            // 이벤트 레벨: 원 입고 이벤트 역분개(reversal)
            if (!line.eventId) {
                throw new BadRequestException('original receive eventId missing; cannot perform reversal');
            }
            const rev = await this.eventStore.reverseEvent(line.eventId, 'CANCEL', tx);

            // 라인 전량 취소 기록(감사 용도)
            await tx.update(wmsTables.inboundReceiptLines)
                .set({ canceledQty: line.quantity })
                .where(eq(wmsTables.inboundReceiptLines.id, line.id));

            // 작업 로그 기록
            await tx.insert(wmsTables.inboundWorkLogs).values({
                type: 'CANCEL',
                receiptId: receipt.id,
                lineId: line.id,
                skuId: line.skuId,
                warehouseId: receipt.warehouseId,
                fromLocationId: originLocationId,
                quantity: line.quantity,
                reason: 'CANCEL',
                eventId: rev?.id ?? null,
            } as any);

            // 모든 라인이 취소되면 헤더를 voided 처리하여 receipts 기반 조회에서 제외
            const lines = await tx.query.inboundReceiptLines.findMany({
                where: eq(wmsTables.inboundReceiptLines.receiptId, line.receiptId),
            });
            const allCanceled = lines.every(l => (l.canceledQty ?? 0) >= (l.quantity ?? 0));
            if (allCanceled) {
                await tx.update(wmsTables.inboundReceipts)
                    .set({ status: 'voided' as any, totalQuantity: 0 })
                    .where(eq(wmsTables.inboundReceipts.id, line.receiptId));
            }

            return { success: true };
        }, tx);
    }

    // 입고 실적 조회
    async getInboundHistory(skuId?: string, warehouseId?: string, days: number = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // 이벤트 스토어에서 입고 이벤트 조회
        const events = await this.eventStore.getEventHistory(
            skuId, // skuId 없으면 전체 조회
            warehouseId,
            startDate.toISOString().split('T')[0],
            new Date().toISOString().split('T')[0]
        );

        // 입고 관련 이벤트만 필터링 (transitionType=RECEIVE)
        const inboundEvents = events.filter(e => e.transitionType === 'RECEIVE');

        // 일별 집계
        const dailyStats: Record<string, { quantity: number; events: number }> = {};

        inboundEvents.forEach(event => {
            const date = new Date(event.occurredAt).toISOString().split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = { quantity: 0, events: 0 };
            }
            dailyStats[date].quantity += event.quantity;
            dailyStats[date].events += 1;
        });

        return {
            period: `Last ${days} days`,
            totalInboundQuantity: inboundEvents.reduce((sum, e) => sum + e.quantity, 0),
            totalInboundEvents: inboundEvents.length,
            domesticInbounds: 0,
            overseasInbounds: 0,
            returnInbounds: 0,
            dailyStats,
            recentEvents: inboundEvents.slice(0, 10), // 최근 10건
        };
    }

    // 입고 검수 (바코드 스캔)
    async verifyInboundByBarcode(barcode: string, expectedSkuId?: string) {
        // 바코드로 SKU 조회
        const skuBarcode = await this.db.query.skuBarcodes.findFirst({
            where: eq(wmsTables.skuBarcodes.barcode, barcode),
        });

        if (!skuBarcode) {
            // 기본 바코드로도 조회
            const sku = await this.db.query.skus.findFirst({
                where: eq(wmsTables.skus.defaultBarcode, barcode),
            });

            if (!sku) {
                throw new NotFoundException(`바코드 ${barcode}에 해당하는 SKU를 찾을 수 없습니다.`);
            }

            // 예상 SKU와 다른 경우
            if (expectedSkuId && sku.id !== expectedSkuId) {
                throw new BadRequestException(
                    `스캔한 SKU(${sku.code})가 예상 SKU와 다릅니다.`
                );
            }

            return {
                skuId: sku.id,
                skuCode: sku.code,
                skuName: sku.name,
                barcode: sku.defaultBarcode,
                barcodeType: 'default',
            };
        }

        // SKU 정보 별도 조회
        const sku = await this.db.query.skus.findFirst({
            where: eq(wmsTables.skus.id, skuBarcode.skuId),
        });

        // 예상 SKU와 다른 경우
        if (expectedSkuId && skuBarcode.skuId !== expectedSkuId) {
            throw new BadRequestException(
                `스캔한 SKU(${sku?.code})가 예상 SKU와 다릅니다.`
            );
        }

        return {
            skuId: skuBarcode.skuId,
            skuCode: sku?.code,
            skuName: sku?.name,
            barcode: skuBarcode.barcode,
            barcodeType: skuBarcode.barcodeType,
            packingUnit: skuBarcode.packingUnit,
        };
    }
}