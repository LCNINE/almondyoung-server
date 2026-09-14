import { warehouseEndpoint, warehouseRequest } from '../../core/services/warehouse-operation-contract';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, sql, gte, lte, desc, inArray } from 'drizzle-orm';
import { SkuCatalogService } from '../../sku-catalog/services/sku-catalog.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { SimpleInboundDto, IndividualInboundDto, UpdateInboundLineMemoDto } from '../dto/simple-inbound.dto';
import { CancelInboundDto, PutawayRequestDto, ReturnInboundDto } from '../dto/simple-inbound.dto';
import { InboundReceiptKernel } from '../kernel/inbound-receipt.kernel';
import { InboundReceiptHistoryResponseDto } from '../dto/inbound-response.dto';
import { InboundReceiptLineMapper, InboundReceiptMapper } from '../mappers/inbound.mapper';

@Injectable()
export class InboundService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly skuCatalogService: SkuCatalogService,
    private readonly eventStore: StockEventStore,
    private readonly idempotency: InventoryIdempotencyService,
    private readonly receiptKernel: InboundReceiptKernel,
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

  // 간편입고: 지정 창고의 입고기본존에 여러 SKU를 즉시 입고
  async simpleInbound(dto: SimpleInboundDto, tx?: DbTx, actorId?: string) {
    return this.idempotency.withIdempotency(
      warehouseEndpoint('inbound.simple', dto),
      dto.idempotencyKey,
      warehouseRequest(dto, actorId),
      async (tx) => {
        await this.assertSkusExist(
          dto.items.map((item) => item.skuId),
          tx,
        );
        return this.receiptKernel.recordArrival(
          {
            source: 'direct',
            actorId,
            method: 'simple',
            warehouseId: dto.warehouseId,
            reason: 'simple_inbound',
            lines: dto.items.map((item, i) => ({
              skuId: item.skuId,
              quantity: item.quantity,
              memo: item.memo,
              eventKey: `${warehouseEndpoint('inbound.simple', dto)}:${dto.idempotencyKey}:${i}`,
            })),
          },
          tx,
        );
      },
      tx,
    );
  }

  // 전수조사 간편입고: 처리 로직은 동일하나 회차/로그의 method를 구분
  async simpleInboundFullscan(dto: SimpleInboundDto, tx?: DbTx, actorId?: string) {
    return this.idempotency.withIdempotency(
      warehouseEndpoint('inbound.simple-fullscan', dto),
      dto.idempotencyKey,
      warehouseRequest(dto, actorId),
      async (tx) => {
        await this.assertSkusExist(
          dto.items.map((item) => item.skuId),
          tx,
        );
        return this.receiptKernel.recordArrival(
          {
            source: 'direct',
            actorId,
            method: 'simple_fullscan',
            warehouseId: dto.warehouseId,
            reason: 'simple_inbound_fullscan',
            lines: dto.items.map((item, i) => ({
              skuId: item.skuId,
              quantity: item.quantity,
              memo: item.memo,
              eventKey: `${warehouseEndpoint('inbound.simple-fullscan', dto)}:${dto.idempotencyKey}:${i}`,
            })),
          },
          tx,
        );
      },
      tx,
    );
  }

  // 개별입고: 단일 SKU를 지정 로케이션(옵션, 없으면 기본입고존)으로 입고
  async individualInbound(dto: IndividualInboundDto, tx?: DbTx, actorId?: string) {
    return this.idempotency.withIdempotency(
      warehouseEndpoint('inbound.individual', dto),
      dto.idempotencyKey,
      warehouseRequest(dto, actorId),
      async (tx) => {
        await this.assertSkusExist([dto.skuId], tx);
        const { receipt, lines } = await this.receiptKernel.recordArrival(
          {
            source: 'direct',
            actorId,
            method: 'individual',
            warehouseId: dto.warehouseId,
            locationId: dto.locationId ?? null,
            reason: 'individual_inbound',
            // 개별입고의 현행 이벤트 키는 순번이 없다 — 문자열을 그대로 보존한다.
            lines: [
              {
                skuId: dto.skuId,
                quantity: dto.quantity,
                memo: dto.memo,
                eventKey: `${warehouseEndpoint('inbound.individual', dto)}:${dto.idempotencyKey}`,
              },
            ],
          },
          tx,
        );
        return { receipt, line: lines[0] };
      },
      tx,
    );
  }

  /** 입고 전 SKU 존재 확인 — 현행 404 계약(`SKU ${id} not found`)을 유지한다. */
  private async assertSkusExist(skuIds: string[], tx: DbTx): Promise<void> {
    for (const skuId of skuIds) {
      const sku = await this.skuCatalogService.findById(skuId, tx);
      if (!sku) throw new NotFoundException(`SKU ${skuId} not found`);
    }
  }

  // 회차별 입고내역 조회 — 페이지는 헤더 기준, 선택된 회차는 전체 라인을 반환한다.
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
  ): Promise<InboundReceiptHistoryResponseDto> {
    const { skuId, warehouseId, method, startDate, endDate, limit = 50, offset = 0 } = params;
    return this.dbService.run(async (tx) => {
      const receiptIdsForSku = skuId
        ? tx
            .select({ id: wmsTables.inboundReceiptLines.receiptId })
            .from(wmsTables.inboundReceiptLines)
            .where(eq(wmsTables.inboundReceiptLines.skuId, skuId))
        : undefined;
      const receiptWhere = and(
        eq(wmsTables.inboundReceipts.status, 'posted'),
        warehouseId ? eq(wmsTables.inboundReceipts.warehouseId, warehouseId) : undefined,
        method ? eq(wmsTables.inboundReceipts.method, method) : undefined,
        receiptIdsForSku ? inArray(wmsTables.inboundReceipts.id, receiptIdsForSku) : undefined,
        startDate ? gte(wmsTables.inboundReceipts.occurredAt, new Date(startDate)) : undefined,
        endDate
          ? lte(wmsTables.inboundReceipts.occurredAt, new Date(new Date(endDate).setHours(23, 59, 59, 999)))
          : undefined,
      );

      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(wmsTables.inboundReceipts)
        .where(receiptWhere);
      const receipts = await tx
        .select()
        .from(wmsTables.inboundReceipts)
        .where(receiptWhere)
        .orderBy(desc(wmsTables.inboundReceipts.occurredAt), desc(wmsTables.inboundReceipts.id))
        .limit(limit)
        .offset(offset);
      const receiptIds = receipts.map((receipt) => receipt.id);
      const lines =
        receiptIds.length === 0
          ? []
          : await tx
              .select()
              .from(wmsTables.inboundReceiptLines)
              .where(inArray(wmsTables.inboundReceiptLines.receiptId, receiptIds))
              .orderBy(wmsTables.inboundReceiptLines.createdAt, wmsTables.inboundReceiptLines.id);
      const linesByReceipt = new Map<string, typeof lines>();
      for (const line of lines) {
        const receiptLines = linesByReceipt.get(line.receiptId) ?? [];
        receiptLines.push(line);
        linesByReceipt.set(line.receiptId, receiptLines);
      }

      return {
        total,
        items: receipts.map((receipt) => ({
          ...InboundReceiptMapper.toBaseDto(receipt),
          lines: (linesByReceipt.get(receipt.id) ?? []).map(InboundReceiptLineMapper.toDto),
        })),
      };
    }, tx);
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

  // 즉시 적치(원위치 → 목적지)
  async putawayFromOrigin(dto: PutawayRequestDto, tx?: DbTx, actorId?: string) {
    return this.idempotency.withIdempotency(
      warehouseEndpoint('inbound.putaway', dto),
      dto.idempotencyKey,
      warehouseRequest(dto, actorId),
      async (tx) => {
        await this.receiptKernel.putaway(
          {
            receiptLineId: dto.lineId,
            toLocationId: dto.toLocationId,
            quantity: dto.quantity,
            eventKey: `${warehouseEndpoint('inbound.putaway', dto)}:${dto.idempotencyKey}`,
          },
          tx,
        );
        return { success: true };
      },
      tx,
    );
  }

  // 회송
  async returnInbound(dto: ReturnInboundDto, tx?: DbTx, actorId?: string) {
    return this.idempotency.withIdempotency(
      warehouseEndpoint('inbound.return', dto),
      dto.idempotencyKey,
      warehouseRequest(dto, actorId),
      async (tx) => {
        await this.receiptKernel.returnLine(
          {
            receiptLineId: dto.lineId,
            quantity: dto.quantity,
            reason: dto.reason,
            eventKey: `${warehouseEndpoint('inbound.return', dto)}:${dto.idempotencyKey}`,
          },
          tx,
        );
        return { success: true };
      },
      tx,
    );
  }

  // 입고취소
  async cancelInbound(dto: CancelInboundDto, tx?: DbTx, actorId?: string) {
    return this.idempotency.withIdempotency(
      warehouseEndpoint('inbound.cancel', dto),
      dto.idempotencyKey,
      warehouseRequest(dto, actorId),
      async (tx) => {
        await this.receiptKernel.cancelLine(
          { receiptLineId: dto.lineId, quantity: dto.quantity, expected: { source: 'direct' } },
          tx,
        );

        return { success: true };
      },
      tx,
    );
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
