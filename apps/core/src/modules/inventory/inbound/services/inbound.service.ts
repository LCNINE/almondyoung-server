import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import type { InboundReceipt, InboundReceiptLine } from '../../schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, sql, gte, lte, desc, inArray } from 'drizzle-orm';
import { SkuCatalogService } from '../../sku-catalog/services/sku-catalog.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { SimpleInboundDto, IndividualInboundDto, UpdateInboundLineMemoDto } from '../dto/simple-inbound.dto';
import {
  CancelInboundDto,
  PutawayRequestDto,
  ReturnInboundDto,
  CreateInboundPlanDto,
  AddInboundPlanItemsDto,
  ReceiveFromPlanDto,
  ListPlanItemsQueryDto,
  InboundPendingListResponse,
} from '../dto/simple-inbound.dto';
import { isSameSeoulDay, nowSeoul } from '../../shared/services/time.util';
import { SupplierResponseDto } from '../../suppliers/dto/supplier-response.dto';

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly skuCatalogService: SkuCatalogService,
    private readonly commandService: InventoryCommandService,
    private readonly locationService: LocationService,
    private readonly eventStore: StockEventStore,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  // 입고 라인 메모 수정
  async updateInboundLineMemo(lineId: string, dto: UpdateInboundLineMemoDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const line = await tx.query.inboundReceiptLines.findFirst({
        where: eq(wmsTables.inboundReceiptLines.id, lineId),
      });
      if (!line) throw new NotFoundException('inbound line not found');
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ memo: dto.memo })
        .where(eq(wmsTables.inboundReceiptLines.id, lineId));
      return { success: true };
    }, tx);
  }

  private async getOnHandQuantity(
    tx: DbTx,
    params: { skuId: string; warehouseId: string; locationId: string },
  ): Promise<number> {
    const row = await tx.query.stockLedgers.findFirst({
      where: and(
        eq(wmsTables.stockLedgers.skuId, params.skuId),
        eq(wmsTables.stockLedgers.warehouseId, params.warehouseId),
        eq(wmsTables.stockLedgers.locationId, params.locationId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    });
    return (row?.qty as number) ?? 0;
  }

  // 간편입고: 지정 창고/로케이션에 여러 SKU를 즉시 입고
  async simpleInbound(dto: SimpleInboundDto, tx?: DbTx) {
    const { warehouseId, items } = dto;
    return this.dbService.run(async (tx) => {
      // 간편입고는 항상 시스템 입고기본존으로 (보장 선행)
      await this.locationService.ensureSystemLocations(warehouseId, tx);
      const inboundZone = await this.locationService.getSystemLocationByRole(warehouseId, 'inbound_default', tx);
      if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
      const effectiveLocationId = inboundZone.id;
      // 회차(journal + receipt) 생성
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'inbound',
        })
        .returning();

      const [receipt] = await tx
        .insert(wmsTables.inboundReceipts)
        .values({
          method: 'simple',
          warehouseId,
          locationId: effectiveLocationId,
          occurredAt: new Date(),
          status: 'posted',
          totalQuantity: 0,
          journalId: journal.id,
        })
        .returning();

      let totalQty = 0;
      const lines: InboundReceiptLine[] = [];
      for (const item of items) {
        const sku = await this.skuCatalogService.findById(item.skuId, tx);
        if (!sku) throw new NotFoundException(`SKU ${item.skuId} not found`);

        const { eventId } = await this.commandService.receive(
          {
            skuId: item.skuId,
            toWarehouseId: warehouseId,
            toLocationId: effectiveLocationId,
            quantity: item.quantity,
            occurredAt: new Date(),
            reason: 'simple_inbound',
            journalId: journal.id,
          },
          tx,
        );

        const [line] = await tx
          .insert(wmsTables.inboundReceiptLines)
          .values({
            receiptId: receipt.id,
            skuId: item.skuId,
            quantity: item.quantity,
            originLocationId: effectiveLocationId,
            eventId: eventId ?? null,
            memo: item.memo,
          })
          .returning();

        lines.push(line);
        totalQty += item.quantity;
      }

      const [updatedReceipt] = await tx
        .update(wmsTables.inboundReceipts)
        .set({ totalQuantity: totalQty })
        .where(eq(wmsTables.inboundReceipts.id, receipt.id))
        .returning();

      // 작업 로그 기록 (회차 레벨)
      await tx.insert(wmsTables.inboundWorkLogs).values({
        type: 'INBOUND',
        receiptId: receipt.id,
        warehouseId,
        toLocationId: effectiveLocationId,
        quantity: totalQty,
        method: 'simple',
        reason: 'simple_inbound',
      });

      return { receipt: updatedReceipt, lines };
    }, tx);
  }

  // 전수조사 간편입고: 처리 로직은 동일하나 회차/로그의 method를 구분
  async simpleInboundFullscan(dto: SimpleInboundDto, tx?: DbTx) {
    const { warehouseId, items } = dto;
    return this.dbService.run(async (tx) => {
      await this.locationService.ensureSystemLocations(warehouseId, tx);
      const inboundZone = await this.locationService.getSystemLocationByRole(warehouseId, 'inbound_default', tx);
      if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
      const effectiveLocationId = inboundZone.id;

      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'inbound',
        })
        .returning();

      const [receipt] = await tx
        .insert(wmsTables.inboundReceipts)
        .values({
          method: 'simple_fullscan',
          warehouseId,
          locationId: effectiveLocationId,
          occurredAt: new Date(),
          status: 'posted',
          totalQuantity: 0,
          journalId: journal.id,
        })
        .returning();

      let totalQty = 0;
      const lines: InboundReceiptLine[] = [];
      for (const item of items) {
        const sku = await this.skuCatalogService.findById(item.skuId, tx);
        if (!sku) throw new NotFoundException(`SKU ${item.skuId} not found`);
        const { eventId } = await this.commandService.receive(
          {
            skuId: item.skuId,
            toWarehouseId: warehouseId,
            toLocationId: effectiveLocationId,
            quantity: item.quantity,
            occurredAt: new Date(),
            reason: 'simple_inbound_fullscan',
            journalId: journal.id,
          },
          tx,
        );
        const [line] = await tx
          .insert(wmsTables.inboundReceiptLines)
          .values({
            receiptId: receipt.id,
            skuId: item.skuId,
            quantity: item.quantity,
            originLocationId: effectiveLocationId,
            eventId: eventId ?? null,
            memo: item.memo,
          })
          .returning();
        lines.push(line);
        totalQty += item.quantity;
      }
      const [updatedReceipt] = await tx
        .update(wmsTables.inboundReceipts)
        .set({ totalQuantity: totalQty })
        .where(eq(wmsTables.inboundReceipts.id, receipt.id))
        .returning();
      await tx.insert(wmsTables.inboundWorkLogs).values({
        type: 'INBOUND',
        receiptId: receipt.id,
        warehouseId,
        toLocationId: effectiveLocationId,
        quantity: totalQty,
        method: 'simple_fullscan',
        reason: 'simple_inbound_fullscan',
      });
      return { receipt: updatedReceipt, lines };
    }, tx);
  }

  // 개별입고: 단일 SKU를 지정 로케이션(옵션, 없으면 기본입고존)으로 입고
  async individualInbound(dto: IndividualInboundDto, tx?: DbTx) {
    const { warehouseId, skuId, quantity } = dto;
    return this.dbService.run(async (tx) => {
      let effectiveLocationId = dto.locationId ?? null;
      if (!effectiveLocationId) {
        await this.locationService.ensureSystemLocations(warehouseId, tx);
        const inboundZone = await this.locationService.getSystemLocationByRole(warehouseId, 'inbound_default', tx);
        if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
        effectiveLocationId = inboundZone.id;
      }

      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'inbound',
        })
        .returning();

      const [receipt] = await tx
        .insert(wmsTables.inboundReceipts)
        .values({
          method: 'individual',
          warehouseId,
          locationId: effectiveLocationId,
          occurredAt: new Date(),
          status: 'posted',
          totalQuantity: 0,
          journalId: journal.id,
        })
        .returning();

      const sku = await this.skuCatalogService.findById(skuId, tx);
      if (!sku) throw new NotFoundException(`SKU ${skuId} not found`);

      const { eventId } = await this.commandService.receive(
        {
          skuId,
          toWarehouseId: warehouseId,
          toLocationId: effectiveLocationId,
          quantity,
          occurredAt: new Date(),
          reason: 'individual_inbound',
          journalId: journal.id,
        },
        tx,
      );

      const [line] = await tx
        .insert(wmsTables.inboundReceiptLines)
        .values({
          receiptId: receipt.id,
          skuId,
          quantity,
          originLocationId: effectiveLocationId,
          eventId: eventId ?? null,
          memo: dto.memo,
        })
        .returning();

      await tx
        .update(wmsTables.inboundReceipts)
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
      });

      return { receipt, line };
    }, tx);
  }

  // 입고 예정 목록 조회 (이중 입고 계획 지원)
  async getInboundPending(warehouseId?: string, tx?: DbTx): Promise<InboundPendingListResponse> {
    return this.dbService.run(async (tx) => {
      const { inboundPlans, inboundPlanItems, purchaseOrders, suppliers, skus } = wmsTables;

      // 1. pending 상태의 plans 조회
      const planConditions = [eq(inboundPlans.status, 'pending')];
      if (warehouseId) {
        planConditions.push(eq(inboundPlans.warehouseId, warehouseId));
      }

      const plansData = await tx
        .select({
          planId: inboundPlans.id,
          planType: inboundPlans.planType,
          warehouseId: inboundPlans.warehouseId,
          expectedDate: inboundPlans.expectedDate,
          parentPlanId: inboundPlans.parentPlanId,
          linkedPurchaseOrderId: inboundPlans.linkedPurchaseOrderId,
          poId: purchaseOrders.id,
          poType: purchaseOrders.type,
          // Supplier 전체 정보
          supplierId: suppliers.id,
          supplierName: suppliers.name,
          supplierPhone: suppliers.phone,
          supplierFax: suppliers.fax,
          supplierEmail: suppliers.email,
          supplierZipcode: suppliers.zipcode,
          supplierAddress1: suppliers.address1,
          supplierAddress2: suppliers.address2,
          supplierBusinessRegNo: suppliers.businessRegNo,
          supplierBusinessType: suppliers.businessType,
          supplierCeoName: suppliers.ceoName,
          supplierIsDirectDelivery: suppliers.isDirectDelivery,
          supplierOrderCutoffTime: suppliers.orderCutoffTime,
          supplierBankName: suppliers.bankName,
          supplierBankAccountNo: suppliers.bankAccountNo,
          supplierBankAccountHolder: suppliers.bankAccountHolder,
          supplierPaymentMethod: suppliers.paymentMethod,
          supplierDescription: suppliers.description,
          supplierMemo: suppliers.memo,
          supplierPurchaseManagerId: suppliers.purchaseManagerId,
          supplierDefaultWarehouseId: suppliers.defaultWarehouseId,
          supplierCreatedAt: suppliers.createdAt,
          supplierUpdatedAt: suppliers.updatedAt,
        })
        .from(inboundPlans)
        .innerJoin(purchaseOrders, eq(inboundPlans.linkedPurchaseOrderId, purchaseOrders.id))
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(and(...planConditions));

      if (plansData.length === 0) {
        return {
          warehouseId,
          totalPendingPlans: 0,
          totalPendingQuantity: 0,
          pendingPlans: [],
        };
      }

      const planIds = plansData.map((p) => p.planId);

      // 2. pending items 조회 (SKU 정보 포함)
      const itemsData = await tx
        .select({
          planItemId: inboundPlanItems.id,
          planId: inboundPlanItems.planId,
          skuId: inboundPlanItems.skuId,
          skuName: skus.name,
          skuCode: skus.code,
          expectedQty: inboundPlanItems.expectedQty,
          receivedQty: inboundPlanItems.receivedQty,
        })
        .from(inboundPlanItems)
        .innerJoin(skus, eq(inboundPlanItems.skuId, skus.id))
        .where(and(inArray(inboundPlanItems.planId, planIds), eq(inboundPlanItems.status, 'pending')));

      // 3. parent plans 조회 (있는 경우에만)
      const parentPlanIds = plansData.map((p) => p.parentPlanId).filter((id) => id !== null);

      const parentPlansMap = new Map<string, { status: string }>();
      if (parentPlanIds.length > 0) {
        const parentPlansData = await tx
          .select({
            id: inboundPlans.id,
            status: inboundPlans.status,
          })
          .from(inboundPlans)
          .where(inArray(inboundPlans.id, parentPlanIds));

        parentPlansData.forEach((p) => {
          parentPlansMap.set(p.id, { status: p.status });
        });
      }

      // 4. 데이터 조합
      const inboundPending = plansData.map((plan) => {
        const planItems = itemsData.filter((item) => item.planId === plan.planId);
        const parentPlan = plan.parentPlanId ? parentPlansMap.get(plan.parentPlanId) : null;

        return {
          planId: plan.planId,
          planType: plan.planType,
          warehouseId: plan.warehouseId,
          expectedDate: plan.expectedDate,
          isLinkedPlan: !!plan.parentPlanId,
          sourcePlanStatus: parentPlan?.status,
          purchaseOrder: {
            id: plan.poId,
            type: plan.poType,
            supplier: plan.supplierId
              ? SupplierResponseDto.fromDbRow({
                  id: plan.supplierId,
                  name: plan.supplierName!,
                  phone: plan.supplierPhone,
                  fax: plan.supplierFax,
                  email: plan.supplierEmail,
                  zipcode: plan.supplierZipcode,
                  address1: plan.supplierAddress1,
                  address2: plan.supplierAddress2,
                  businessRegNo: plan.supplierBusinessRegNo,
                  businessType: plan.supplierBusinessType,
                  ceoName: plan.supplierCeoName,
                  isDirectDelivery: plan.supplierIsDirectDelivery,
                  orderCutoffTime: plan.supplierOrderCutoffTime,
                  bankName: plan.supplierBankName,
                  bankAccountNo: plan.supplierBankAccountNo,
                  bankAccountHolder: plan.supplierBankAccountHolder,
                  paymentMethod: plan.supplierPaymentMethod,
                  description: plan.supplierDescription,
                  memo: plan.supplierMemo,
                  purchaseManagerId: plan.supplierPurchaseManagerId,
                  defaultWarehouseId: plan.supplierDefaultWarehouseId,
                  createdAt: plan.supplierCreatedAt!,
                  updatedAt: plan.supplierUpdatedAt!,
                })
              : undefined,
          },
          items: planItems.map((item) => ({
            planItemId: item.planItemId,
            skuId: item.skuId,
            skuName: item.skuName,
            skuCode: item.skuCode,
            expectedQty: item.expectedQty,
            receivedQty: item.receivedQty,
            pendingQty: item.expectedQty - item.receivedQty,
          })),
          totalQuantity: planItems.reduce((sum, item) => sum + item.expectedQty, 0),
          totalPendingQuantity: planItems.reduce((sum, item) => sum + (item.expectedQty - item.receivedQty), 0),
        };
      });

      return {
        warehouseId,
        totalPendingPlans: inboundPending.length,
        totalPendingQuantity: inboundPending.reduce((sum, plan) => sum + plan.totalPendingQuantity, 0),
        pendingPlans: inboundPending,
      };
    }, tx);
  }

  // 입고내역(현황) 조회 - (sku, quantity, occurredAt, method)
  async listInboundReceipts(
    params: {
      skuId?: string;
      warehouseId?: string;
      method?: 'individual' | 'simple' | 'simple_fullscan' | 'planned';
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ) {
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
      .where(
        and(
          eq(wmsTables.inboundReceipts.status, 'posted'),
          warehouseId ? eq(wmsTables.inboundReceipts.warehouseId, warehouseId) : undefined,
          method ? eq(wmsTables.inboundReceipts.method, method) : undefined,
          skuId ? eq(wmsTables.inboundReceiptLines.skuId, skuId) : undefined,
          startDate ? gte(wmsTables.inboundReceipts.occurredAt, new Date(startDate)) : undefined,
          endDate
            ? lte(wmsTables.inboundReceipts.occurredAt, new Date(new Date(endDate).setHours(23, 59, 59, 999)))
            : undefined,
        ),
      )
      .orderBy(desc(wmsTables.inboundReceipts.occurredAt))
      .limit(limit)
      .offset(offset);

    return { total: rows.length, items: rows };
  }

  // 입고 작업 타임라인 조회
  async listInboundWorkLogs(
    params: {
      warehouseId?: string;
      skuId?: string;
      type?: 'INBOUND' | 'PUTAWAY' | 'RETURN' | 'CANCEL';
      method?: 'individual' | 'simple' | 'simple_fullscan' | 'planned';
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ) {
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
      .where(
        and(
          warehouseId ? eq(wmsTables.inboundWorkLogs.warehouseId, warehouseId) : undefined,
          skuId ? eq(wmsTables.inboundWorkLogs.skuId, skuId) : undefined,
          type ? eq(wmsTables.inboundWorkLogs.type, type) : undefined,
          method ? eq(wmsTables.inboundWorkLogs.method, method) : undefined,
          startDate ? gte(wmsTables.inboundWorkLogs.timestamp, new Date(startDate)) : undefined,
          endDate
            ? lte(wmsTables.inboundWorkLogs.timestamp, new Date(new Date(endDate).setHours(23, 59, 59, 999)))
            : undefined,
        ),
      )
      .orderBy(desc(wmsTables.inboundWorkLogs.timestamp))
      .limit(limit)
      .offset(offset);

    return { total: logs.length, items: logs };
  }

  // 집계 입고현황: 라인 단위 결과 + 확정수량(취소/회송 반영)
  async listInboundStatus(
    params: {
      skuId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ) {
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
      .where(
        and(
          eq(wmsTables.inboundReceipts.status, 'posted'),
          warehouseId ? eq(wmsTables.inboundReceipts.warehouseId, warehouseId) : undefined,
          skuId ? eq(wmsTables.inboundReceiptLines.skuId, skuId) : undefined,
          startDate ? gte(wmsTables.inboundReceipts.occurredAt, new Date(startDate)) : undefined,
          endDate
            ? lte(wmsTables.inboundReceipts.occurredAt, new Date(new Date(endDate).setHours(23, 59, 59, 999)))
            : undefined,
        ),
      )
      .orderBy(desc(wmsTables.inboundReceipts.occurredAt))
      .limit(limit)
      .offset(offset);

    const items = rows
      .map((r) => {
        const confirmed = Math.max(0, (r.qtyReceived ?? 0) - (r.qtyReturned ?? 0));
        return { ...r, confirmedQty: confirmed };
      })
      .filter((r) => r.confirmedQty > 0);

    return { total: items.length, items };
  }

  // 입고예정 생성
  async createInboundPlan(dto: CreateInboundPlanDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { purchaseOrders } = wmsTables;

      // 발주 존재 여부 확인
      const [po] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, dto.linkedPurchaseOrderId))
        .limit(1);

      if (!po) {
        throw new Error(`Purchase order not found: ${dto.linkedPurchaseOrderId}`);
      }

      // destinationWarehouseId가 없으면 warehouseId를 사용
      const destinationWarehouseId = dto.destinationWarehouseId ?? dto.warehouseId;
      const planType = dto.planType ?? 'destination';
      const requiresTransfer = dto.requiresTransfer ?? false;

      const [plan] = await tx
        .insert(wmsTables.inboundPlans)
        .values({
          expectedDate: new Date(dto.expectedDate),
          warehouseId: dto.warehouseId,
          destinationWarehouseId,
          linkedPurchaseOrderId: dto.linkedPurchaseOrderId,
          planType,
          requiresTransfer,
          parentPlanId: dto.parentPlanId,
          status: 'pending',
        })
        .returning();

      return plan;
    }, tx);
  }

  // 입고예정 아이템 추가
  async addInboundPlanItems(dto: AddInboundPlanItemsDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const plan = await tx.query.inboundPlans.findFirst({ where: eq(wmsTables.inboundPlans.id, dto.planId) });
      if (!plan) throw new NotFoundException('inbound plan not found');
      for (const item of dto.items) {
        await tx.insert(wmsTables.inboundPlanItems).values({
          planId: dto.planId,
          skuId: item.skuId,
          expectedQty: item.expectedQty,
          receivedQty: 0,
          status: 'pending',
        });
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
      .where(
        and(
          warehouseId ? eq(wmsTables.inboundPlans.warehouseId, warehouseId) : undefined,
          skuId ? eq(wmsTables.inboundPlanItems.skuId, skuId) : undefined,
          startDate ? gte(wmsTables.inboundPlans.expectedDate, new Date(startDate)) : undefined,
          endDate
            ? lte(wmsTables.inboundPlans.expectedDate, new Date(new Date(endDate).setHours(23, 59, 59, 999)))
            : undefined,
        ),
      )
      .orderBy(desc(wmsTables.inboundPlans.expectedDate));
    return { total: rows.length, items: rows };
  }

  // 입고예정 아이템 기반 실입고 처리
  async receiveFromPlan(dto: ReceiveFromPlanDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const item = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, dto.planItemId),
      });
      if (!item) throw new NotFoundException('inbound plan item not found');
      const plan = await tx.query.inboundPlans.findFirst({ where: eq(wmsTables.inboundPlans.id, item.planId) });
      if (!plan) throw new NotFoundException('inbound plan not found');

      // 위치 결정 (옵션, 없으면 기본입고존)
      let effectiveLocationId = dto.locationId ?? null;
      if (!effectiveLocationId) {
        await this.locationService.ensureSystemLocations(plan.warehouseId, tx);
        const inboundZone = await this.locationService.getSystemLocationByRole(plan.warehouseId, 'inbound_default', tx);
        if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
        effectiveLocationId = inboundZone.id;
      }

      // 회차(journal + receipt) 생성
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'inbound',
        })
        .returning();
      const [receipt] = await tx
        .insert(wmsTables.inboundReceipts)
        .values({
          method: 'planned',
          warehouseId: plan.warehouseId,
          locationId: effectiveLocationId,
          occurredAt: new Date(),
          status: 'posted',
          totalQuantity: 0,
          journalId: journal.id,
        })
        .returning();

      // 이벤트 생성 + 라인 생성
      const { eventId } = await this.commandService.receive(
        {
          skuId: item.skuId,
          toWarehouseId: plan.warehouseId,
          toLocationId: effectiveLocationId,
          quantity: dto.quantity,
          occurredAt: new Date(),
          reason: 'planned_inbound',
          journalId: journal.id,
        },
        tx,
      );
      await tx.insert(wmsTables.inboundReceiptLines).values({
        receiptId: receipt.id,
        skuId: item.skuId,
        quantity: dto.quantity,
        originLocationId: effectiveLocationId,
        eventId: eventId ?? null,
        planItemId: item.id,
      });

      // 예정 누계/상태 갱신
      const newReceived = (item.receivedQty ?? 0) + dto.quantity;
      const newStatus = newReceived >= item.expectedQty ? 'confirmed' : 'pending';
      await tx
        .update(wmsTables.inboundPlanItems)
        .set({ receivedQty: newReceived, status: newStatus })
        .where(eq(wmsTables.inboundPlanItems.id, item.id));

      await tx
        .update(wmsTables.inboundReceipts)
        .set({ totalQuantity: dto.quantity })
        .where(eq(wmsTables.inboundReceipts.id, receipt.id));

      await tx.insert(wmsTables.inboundWorkLogs).values({
        type: 'INBOUND',
        receiptId: receipt.id,
        lineId: null,
        skuId: item.skuId,
        warehouseId: plan.warehouseId,
        toLocationId: effectiveLocationId,
        quantity: dto.quantity,
        method: 'planned',
        reason: 'planned_inbound',
      });

      return { success: true, receiptId: receipt.id };
    }, tx);
  }

  // 즉시 적치(원위치 → 목적지)
  async putawayFromOrigin(dto: PutawayRequestDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
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
      if (dest.warehouseId !== receipt.warehouseId)
        throw new BadRequestException('destination location must be in the same warehouse');

      const originAvailable = line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty;
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

      // 내부 이동: 원본 위치 → 목표 위치 (즉시)
      const moveResult = await this.commandService.moveInternal(
        {
          skuId: line.skuId,
          warehouseId: receipt.warehouseId,
          fromLocationId: originLocationId,
          toLocationId: dto.toLocationId,
          quantity: dto.quantity,
          reason: 'putaway_internal_move',
        },
        tx,
      );

      await tx
        .update(wmsTables.inboundReceiptLines)
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
        eventId: moveResult.eventId ?? null,
      });

      return { success: true };
    }, tx);
  }

  // 회송
  async returnInbound(dto: ReturnInboundDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
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
      const originAvailable = line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty;
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

      const event = await this.eventStore.createEvent(
        {
          skuId: line.skuId,
          fromWarehouseId: receipt.warehouseId,
          fromLocationId: originLocationId,
          fromState: 'ON_HAND',
          transitionType: 'ADJUST_DOWN',
          quantity: dto.quantity,
          occurredAt: new Date(),
          reason: 'RETURN',
        },
        tx,
      );

      await tx
        .update(wmsTables.inboundReceiptLines)
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
        reason: dto.reason,
        eventId: event?.id ?? null,
      });

      return { success: true };
    }, tx);
  }

  // 입고취소
  async cancelInbound(dto: CancelInboundDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
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
      if (!isSameSeoulDay(nowSeoul(), receiptRow.occurredAt)) {
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
      await tx
        .update(wmsTables.inboundReceiptLines)
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
      });

      // 모든 라인이 취소되면 헤더를 voided 처리하여 receipts 기반 조회에서 제외
      const lines = await tx.query.inboundReceiptLines.findMany({
        where: eq(wmsTables.inboundReceiptLines.receiptId, line.receiptId),
      });
      const allCanceled = lines.every((l) => (l.canceledQty ?? 0) >= (l.quantity ?? 0));
      if (allCanceled) {
        await tx
          .update(wmsTables.inboundReceipts)
          .set({ status: 'voided', totalQuantity: 0 })
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
      new Date().toISOString().split('T')[0],
    );

    // 입고 관련 이벤트만 필터링 (transitionType=RECEIVE)
    const inboundEvents = events.filter((e) => e.transitionType === 'RECEIVE');

    // 일별 집계
    const dailyStats: Record<string, { quantity: number; events: number }> = {};

    inboundEvents.forEach((event) => {
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
      throw new NotFoundException(`바코드 ${barcode}에 해당하는 SKU를 찾을 수 없습니다.`);
    }

    // SKU 정보 별도 조회
    const sku = await this.db.query.skus.findFirst({
      where: eq(wmsTables.skus.id, skuBarcode.skuId),
    });

    // 예상 SKU와 다른 경우
    if (expectedSkuId && skuBarcode.skuId !== expectedSkuId) {
      throw new BadRequestException(`스캔한 SKU(${sku?.code})가 예상 SKU와 다릅니다.`);
    }

    return {
      skuId: skuBarcode.skuId,
      skuCode: sku?.code,
      skuName: sku?.name,
      barcode: skuBarcode.barcode,
      isPrimary: skuBarcode.isPrimary,
      packingUnit: skuBarcode.packingUnit,
    };
  }
}
