import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import type { PurchaseOrderLine } from '../../schema/inventory.schema';
import { InboundReceiptKernel } from '../../inbound/kernel/inbound-receipt.kernel';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { PurchaseOrderResponse } from '../dto/purchase-order.dto';
import {
  CancelPurchaseOrderReceiptLineDto,
  PurchaseOrderReceiptCancelResponseDto,
  PurchaseOrderReceiptResponseDto,
  ReceivePurchaseOrderDto,
  ShortClosePurchaseOrderLineDto,
  UpdateLineExpectedArrivalDto,
} from '../dto/purchase-order/receiving.dto';
import { PurchaseOrderHeaderDeriver } from './purchase-order-header.deriver';
import { PurchaseOrderReader } from './purchase-order.reader';
import { acceptsChanges, outstandingQty } from './purchase-order-status.rules';

const STATUS_LABEL = {
  created: '생성됨',
  confirmed: '확정됨',
  received: '입고완료',
  cancelled: '취소됨',
} as const;

/**
 * 발주 수령 정산. 현장 작업(회차·원장)은 입고 커널에 맡기고 발주 라인 카운터와 링크를 원자적으로 갱신한다.
 *
 * 잠금 순서는 발주 행 FOR UPDATE → 요청 라인 FOR UPDATE(sku_id 오름차순) → 커널의 회차 라인 FOR UPDATE →
 * 회차 헤더 FOR NO KEY UPDATE다. 모든 public 메서드는 전달받은 tx를 마지막 인자로 전파한다.
 */
@Injectable()
export class PurchaseOrderReceivingManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly kernel: InboundReceiptKernel,
    private readonly idempotency: InventoryIdempotencyService,
    private readonly headerDeriver: PurchaseOrderHeaderDeriver,
    private readonly reader: PurchaseOrderReader,
  ) {}

  async receive(poId: string, dto: ReceivePurchaseOrderDto, tx?: DbTx): Promise<PurchaseOrderReceiptResponseDto> {
    return this.idempotency.withIdempotency(
      'purchase_order.receive',
      dto.idempotencyKey,
      { poId, ...dto },
      async (trx) => {
        const po = await this.lockHeader(trx, poId);
        if (po.status === 'cancelled') throw new ConflictError('취소된 발주입니다');
        if (po.sourceWarehouseId !== dto.warehouseId) {
          const [warehouse] = await trx
            .select({ name: wmsTables.warehouses.name })
            .from(wmsTables.warehouses)
            .where(eq(wmsTables.warehouses.id, po.sourceWarehouseId))
            .limit(1);
          throw new BadRequestError(`이 발주는 ${warehouse?.name ?? po.sourceWarehouseId}에서 받습니다`);
        }

        const skuIds = [...new Set(dto.lines.map((line) => line.skuId))].sort();
        const lockedLines = await this.lockLines(trx, poId, skuIds);
        const lineBySku = new Map(lockedLines.map((line) => [line.skuId, line]));
        for (const requested of dto.lines) {
          const line = lineBySku.get(requested.skuId);
          if (!line) throw new NotFoundError(`발주에 없는 품목입니다: ${requested.skuId}`);
          if (line.status === 'requested') throw new ConflictError(`아직 주문 전인 품목입니다: ${requested.skuId}`);
          if (line.status === 'unavailable') {
            throw new ConflictError(`발주 불가로 종결된 품목입니다: ${requested.skuId}`);
          }
          if (line.closedAt !== null) throw new ConflictError(`잔량 포기된 품목입니다: ${requested.skuId}`);
          const outstanding = outstandingQty(line);
          if (outstanding === 0) throw new ConflictError(`이미 전량 입고된 품목입니다: ${requested.skuId}`);
          if (requested.quantity > outstanding) {
            throw new ConflictError(`남은 수량 ${outstanding}개를 넘습니다 — 넘는 분량은 간편입고로 받으세요`);
          }
        }

        const arrival = await this.kernel.recordArrival(
          {
            source: 'purchase_order',
            warehouseId: dto.warehouseId,
            locationId: dto.locationId,
            reason: 'planned_inbound',
            lines: dto.lines.map((line, index) => ({
              skuId: line.skuId,
              quantity: line.quantity,
              memo: line.memo,
              eventKey: `purchase_order.receive:${dto.idempotencyKey}:${index}`,
            })),
          },
          trx,
        );

        await trx
          .insert(wmsTables.purchaseOrderReceiptLines)
          .values(arrival.lines.map((line) => ({ poId, skuId: line.skuId, receiptLineId: line.id })));
        for (const received of arrival.lines) {
          const line = lineBySku.get(received.skuId);
          if (!line) throw new Error(`validated purchase order line vanished under lock: ${poId}/${received.skuId}`);
          await trx
            .update(wmsTables.purchaseOrderLines)
            .set({ receivedQty: line.receivedQty + received.quantity })
            .where(
              and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, received.skuId)),
            );
        }
        await this.headerDeriver.refresh(poId, trx);
        return {
          receiptId: arrival.receipt.id,
          poId,
          lines: arrival.lines.map((line) => ({
            receiptLineId: line.id,
            skuId: line.skuId,
            quantity: line.quantity,
          })),
        };
      },
      tx,
    );
  }

  async cancelReceiptLine(
    receiptLineId: string,
    dto: CancelPurchaseOrderReceiptLineDto,
    tx?: DbTx,
  ): Promise<PurchaseOrderReceiptCancelResponseDto> {
    return this.idempotency.withIdempotency(
      'purchase_order.receipt.cancel',
      dto.idempotencyKey,
      { receiptLineId },
      async (trx) => {
        const [link] = await trx
          .select()
          .from(wmsTables.purchaseOrderReceiptLines)
          .where(eq(wmsTables.purchaseOrderReceiptLines.receiptLineId, receiptLineId))
          .limit(1);
        if (!link) throw new NotFoundError('발주 입고 라인이 아닙니다');

        await this.lockHeader(trx, link.poId);
        const [line] = await this.lockLines(trx, link.poId, [link.skuId]);
        if (!line) throw new Error(`linked purchase order line vanished: ${link.poId}/${link.skuId}`);
        const cancelled = await this.kernel.cancelLine({ receiptLineId, expected: { source: 'purchase_order' } }, trx);
        await trx
          .update(wmsTables.purchaseOrderLines)
          .set({ receivedQty: line.receivedQty - cancelled.quantity })
          .where(
            and(eq(wmsTables.purchaseOrderLines.poId, link.poId), eq(wmsTables.purchaseOrderLines.skuId, link.skuId)),
          );
        await this.headerDeriver.refresh(link.poId, trx);
        return { poId: link.poId, skuId: link.skuId, quantity: cancelled.quantity, receiptLineId };
      },
      tx,
    );
  }

  async shortCloseLine(
    poId: string,
    skuId: string,
    dto: ShortClosePurchaseOrderLineDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const po = await this.lockHeader(trx, poId);
      if (po.status === 'cancelled') throw new ConflictError('취소된 발주입니다');
      const [line] = await this.lockLines(trx, poId, [skuId]);
      if (!line) throw new NotFoundError(`발주에 없는 품목입니다: ${skuId}`);
      if (line.status === 'requested') throw new ConflictError('아직 주문 전인 품목입니다');
      if (line.status === 'unavailable') throw new ConflictError('발주 불가로 종결된 품목입니다');
      if (line.closedAt !== null) throw new ConflictError('이미 잔량 포기된 품목입니다');
      if (outstandingQty(line) === 0) throw new ConflictError('이미 전량 입고된 품목입니다');

      await trx
        .update(wmsTables.purchaseOrderLines)
        .set({ closedReason: dto.reason, closedAt: new Date(), closedBy: userId })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
      await this.headerDeriver.refresh(poId, trx);
      return this.reader.findById(poId, trx);
    }, tx);
  }

  async updateLineExpectedArrival(
    poId: string,
    skuId: string,
    dto: UpdateLineExpectedArrivalDto,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const po = await this.lockHeader(trx, poId);
      if (!acceptsChanges(po.status)) {
        throw new ConflictError(`${STATUS_LABEL[po.status]} 발주는 예정일을 수정할 수 없습니다`);
      }
      const [line] = await this.lockLines(trx, poId, [skuId]);
      if (!line) throw new NotFoundError(`발주에 없는 품목입니다: ${skuId}`);
      if (line.status !== 'requested' && outstandingQty(line) === 0) {
        throw new ConflictError('더 받을 것이 없는 품목은 예정일을 수정할 수 없습니다');
      }

      await trx
        .update(wmsTables.purchaseOrderLines)
        .set({ expectedArrival: dto.expectedArrival })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
      return this.reader.findById(poId, trx);
    }, tx);
  }

  private async lockHeader(tx: DbTx, poId: string) {
    const [po] = await tx
      .select()
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1)
      .for('update');
    if (!po) throw new NotFoundError(`발주를 찾을 수 없습니다: ${poId}`);
    return po;
  }

  /** 같은 발주의 여러 요청이 SKU 배열 순서가 달라도 같은 순서로 잠근다. */
  private lockLines(tx: DbTx, poId: string, skuIds: string[]): Promise<PurchaseOrderLine[]> {
    if (skuIds.length === 0) return Promise.resolve([]);
    return tx
      .select()
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), inArray(wmsTables.purchaseOrderLines.skuId, skuIds)))
      .orderBy(wmsTables.purchaseOrderLines.skuId)
      .for('update');
  }
}
