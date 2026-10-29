import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import type {
  ChannelReturnCancelledPayload,
  ChannelReturnRequestedPayload,
  SalesChannel,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { enqueueSalesOrderClaimProgress } from '../common/claim-progress';
import { transitionCustomerReturn } from './customer-return-transition';
import { ACTIVE_PICKUP_STATUSES, mayHoldReservation, newPickupRow } from './customer-return-pickup.types';

/** 교환 줄의 원본 — 원래 판매 줄에서 옮기는 칸(N12). */
type ExchangeSourceLine = {
  id: string;
  variantId: string;
  productName: string;
  fulfillmentKind: string | null;
  requiresShipping: boolean | null;
  channelProductId: string | null;
};

/**
 * 채널(Medusa) 반품 확정·취소 사실을 «반품 예정» 기록으로 옮긴다 (K8 PR5).
 * 같은 사실이 몇 번 와도 기록·줄·고객 이벤트는 한 번만 생긴다(N7).
 * 교환(K8 PR11)도 같은 기록이다 — 접수가 같은 판매주문에 «교환 줄»(다시 보낼 것, 0원)을 함께 만들고, 취소가 지운다.
 */
@Injectable()
export class CustomerReturnManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
    private readonly lineCompositions: LineCompositionManager,
  ) {}

  async recordRequested(
    fact: ChannelReturnRequestedPayload,
    tx?: DbTx,
  ): Promise<{ customerReturnId: string; created: boolean }> {
    return this.dbService.run(async (trx) => {
      // 이미 기록된 사실의 재전달은 주문이 그 사이 바뀌었어도 검증 없이 «이미 있음»이다(N7)
      const already = await this.findExistingByChannelReturnId(trx, fact.returnId);
      if (already) return { customerReturnId: already.id, created: false };

      const duplicated = fact.items.find(
        (item, i) => fact.items.findIndex((o) => o.channelOrderItemId === item.channelOrderItemId) !== i,
      );
      if (duplicated) {
        throw new BadRequestError(`Duplicate channel order item in return: ${duplicated.channelOrderItemId}`);
      }

      const salesOrderId = await this.findSalesOrderId(trx, fact.salesChannel, fact.externalOrderId);
      const lines = await this.resolveLines(trx, salesOrderId, fact.items);
      // 구성 없는 줄이 하나라도 있으면 아무것도 쓰기 전에 거절한다(N3)
      const compositions = await this.resolveCompositions(trx, lines);
      const kind = fact.kind ?? 'return';
      // 교환 줄은 원래 줄의 굳은 구성을 복사한다 — 안 굳은 줄이 있으면 역시 쓰기 전에 거절한다(N12)
      const exchangeSources = kind === 'exchange' ? await this.loadExchangeSources(trx, lines) : null;

      const [inserted] = await trx
        .insert(wmsTables.customerReturns)
        .values({
          salesOrderId,
          channelReturnId: fact.returnId,
          channelRequestId: fact.requestId,
          reason: fact.reason,
          feeBearer: fact.feeBearer,
          requestedBy: fact.requestedBy,
          windowOverrideReason: fact.windowOverrideReason ?? null,
          requestedAt: new Date(fact.requestedAt),
          kind,
        })
        .onConflictDoNothing({ target: wmsTables.customerReturns.channelReturnId })
        .returning({ id: wmsTables.customerReturns.id });

      if (!inserted) {
        const existing = await this.findByChannelReturnId(trx, fact.returnId);
        return { customerReturnId: existing.id, created: false };
      }

      const insertedLines = await trx
        .insert(wmsTables.customerReturnLines)
        .values(
          lines.map((line) => ({
            customerReturnId: inserted.id,
            salesOrderLineId: line.salesOrderLineId,
            channelOrderItemId: line.channelOrderItemId,
            quantity: line.quantity,
          })),
        )
        .returning({
          id: wmsTables.customerReturnLines.id,
          salesOrderLineId: wmsTables.customerReturnLines.salesOrderLineId,
        });
      const returnLineIdBySalesLine = new Map(insertedLines.map((row) => [row.salesOrderLineId, row.id]));
      const itemRows = lines.flatMap((line) => {
        const customerReturnLineId = returnLineIdBySalesLine.get(line.salesOrderLineId);
        if (!customerReturnLineId) {
          throw new Error(`Inserted customer return line not returned for sales line ${line.salesOrderLineId}`);
        }
        return (compositions.get(line.salesOrderLineId) ?? []).map((c) => ({
          customerReturnLineId,
          skuId: c.skuId,
          qtyPerUnit: c.qtyPerUnit,
          expectedQty: line.quantity * c.qtyPerUnit,
        }));
      });
      await trx.insert(wmsTables.customerReturnItems).values(itemRows);
      if (exchangeSources) {
        await this.createExchangeLines(trx, salesOrderId, lines, returnLineIdBySalesLine, exchangeSources);
      }
      // 회수 예약은 접수와 같은 트랜잭션에서 «해야 할 일»로만 남긴다 — 한진 HTTP 는 워커가 트랜잭션 밖에서 보낸다
      await trx.insert(wmsTables.customerReturnPickups).values(newPickupRow(inserted.id, null));
      await enqueueSalesOrderClaimProgress(this.coreOrders, trx, {
        salesOrderId,
        kind,
        stage: 'requested',
        requestId: inserted.id,
        requestedBy: fact.requestedBy === 'operator' ? 'admin' : 'customer',
        occurredAt: new Date(fact.requestedAt),
      });
      return { customerReturnId: inserted.id, created: true };
    }, tx);
  }

  async recordCancelled(
    fact: ChannelReturnCancelledPayload,
    tx?: DbTx,
  ): Promise<{ customerReturnId: string; changed: boolean }> {
    return this.dbService.run(async (trx) => {
      // requested 가 먼저 온다(같은 파티션 키·같은 폴링 순서). 없으면 순서가 깨진 것 — 재시도하지 않는다.
      // 행을 잠근다 — 교환 상자 열기(잠근 기록에 exchange_released_at 을 쓴다)와 엇갈려 열린 교환의 줄을 지우지 않게
      const record = await this.findByChannelReturnId(trx, fact.returnId, { lock: true });
      if (record.status === 'cancelled') return { customerReturnId: record.id, changed: false };
      if (record.kind === 'exchange' && record.exchangeReleasedAt) {
        // 교환 상자가 이미 열렸다 — 다시 보낼 출고가 시작됐으니 조용히 지우지 않고 DLQ 에 남겨 사람이 본다(N16)
        throw new ConflictError(
          `Cannot cancel customer exchange ${record.id} (channel ${fact.returnId}): exchange already released`,
        );
      }

      const moved = await transitionCustomerReturn(trx, {
        id: record.id,
        from: ['expected'],
        to: 'cancelled',
        set: { cancelledAt: new Date(fact.cancelledAt) },
      });
      if (!moved) {
        // Medusa 는 취소됐다는데 core 는 이미 도착·검수 쪽으로 갔다 — DLQ 에 남겨 사람이 본다
        throw new ConflictError(
          `Cannot cancel customer return ${record.id} (channel ${fact.returnId}): status is ${record.status}`,
        );
      }
      await this.tidyActivePickup(trx, record.id);
      if (record.kind === 'exchange') await this.deleteExchangeLines(trx, record.id);
      return { customerReturnId: record.id, changed: true };
    }, tx);
  }

  /**
   * 취소된 반품의 활성 회수 행을 정리한다(N7). 아직 한진에 한 번도 안 보냈고 워커가 잡고 있지도 않은
   * pending 만 바로 void 다. 보낸 적이 있거나 리스가 살아 있으면 한진에 예약이 있을 수 있으니 워커가 취소한다.
   * 활성 행이 없어도 마지막 행이 «예약이 남아 있을 수 있는 failed»(R6)면 cancel_pending 으로 돌린다(R9) —
   * 결과를 모른 채 끝난 예약이 한진에 살아 있으면 취소된 반품의 소포가 기록 없이 온다.
   */
  private async tidyActivePickup(trx: DbTx, customerReturnId: string): Promise<void> {
    const t = wmsTables.customerReturnPickups;
    const now = new Date();
    const voided = await trx
      .update(t)
      .set({ status: 'void', updatedAt: now })
      .where(
        and(
          eq(t.customerReturnId, customerReturnId),
          eq(t.status, 'pending'),
          eq(t.attempts, 0),
          or(isNull(t.leaseUntil), lt(t.leaseUntil, now)),
        ),
      )
      .returning({ id: t.id });
    if (voided.length > 0) return;
    const moved = await trx
      .update(t)
      .set({ status: 'cancel_pending', nextAttemptAt: null, updatedAt: now })
      .where(and(eq(t.customerReturnId, customerReturnId), inArray(t.status, [...ACTIVE_PICKUP_STATUSES])))
      .returning({ id: t.id });
    if (moved.length > 0) return;

    const [latest] = await trx
      .select()
      .from(t)
      .where(eq(t.customerReturnId, customerReturnId))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(1);
    if (!latest || !mayHoldReservation(latest)) return;
    // 리스는 건드리지 않는다 — 놓아주기가 잡고 한진에 취소 중이면 그 결과 CAS(status failed)가 빗나가고,
    // 워커는 리스가 끝난 뒤에야 잡아 한 번 더 묻는다(already_cancelled → cancelled)
    await trx
      .update(t)
      .set({ status: 'cancel_pending', nextAttemptAt: null, updatedAt: now })
      .where(and(eq(t.id, latest.id), eq(t.status, 'failed')));
  }

  /** 교환 줄의 원본 — 원래 판매 줄의 칸. 굳지 않은 줄이 있으면 BadRequestError(N12). */
  private async loadExchangeSources(
    trx: DbTx,
    lines: Array<{ salesOrderLineId: string; channelOrderItemId: string }>,
  ): Promise<Map<string, ExchangeSourceLine>> {
    const sol = wmsTables.salesOrderLines;
    const rows = await trx
      .select({
        id: sol.id,
        variantId: sol.variantId,
        productName: sol.productName,
        fulfillmentKind: sol.fulfillmentKind,
        requiresShipping: sol.requiresShipping,
        channelProductId: sol.channelProductId,
        compositionSource: sol.compositionSource,
      })
      .from(sol)
      .where(
        inArray(
          sol.id,
          lines.map((line) => line.salesOrderLineId),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const line of lines) {
      if (!byId.get(line.salesOrderLineId)?.compositionSource) {
        throw new BadRequestError(`Exchange line has no frozen SKU composition: ${line.channelOrderItemId}`);
      }
    }
    return byId;
  }

  /**
   * 반품 줄마다 같은 판매주문에 교환 줄 하나(N12) — 수량 = 반품 줄 수량, 0원, 채널 줄 없음(정산 사실이 채운다).
   * 구성은 원래 줄의 굳은 구성을 복사한다(LineCompositionManager 만 구성을 쓴다).
   */
  private async createExchangeLines(
    trx: DbTx,
    salesOrderId: string,
    lines: Array<{ salesOrderLineId: string; quantity: number }>,
    returnLineIdBySalesLine: Map<string, string>,
    sources: Map<string, ExchangeSourceLine>,
  ): Promise<void> {
    for (const line of lines) {
      const source = sources.get(line.salesOrderLineId);
      const customerReturnLineId = returnLineIdBySalesLine.get(line.salesOrderLineId);
      if (!source || !customerReturnLineId) {
        throw new Error(`Exchange source vanished for sales line ${line.salesOrderLineId}`);
      }
      const [created] = await trx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId,
          variantId: source.variantId,
          productName: source.productName,
          fulfillmentKind: source.fulfillmentKind,
          requiresShipping: source.requiresShipping,
          channelProductId: source.channelProductId,
          quantity: line.quantity,
          unitPrice: 0,
          totalPrice: 0,
          channelOrderItemId: null,
          exchangeReturnLineId: customerReturnLineId,
        })
        .returning({ id: wmsTables.salesOrderLines.id });
      await this.lineCompositions.copyFrozen({ sourceLineId: source.id, targetLineId: created.id }, trx);
    }
  }

  /** 열기 전 교환의 취소 — 그 교환 줄을 지운다(구성은 cascade). 열린 교환은 호출자가 이미 거절했다(N16). */
  private async deleteExchangeLines(trx: DbTx, customerReturnId: string): Promise<void> {
    const returnLines = await trx
      .select({ id: wmsTables.customerReturnLines.id })
      .from(wmsTables.customerReturnLines)
      .where(eq(wmsTables.customerReturnLines.customerReturnId, customerReturnId));
    if (returnLines.length === 0) return;
    await trx.delete(wmsTables.salesOrderLines).where(
      inArray(
        wmsTables.salesOrderLines.exchangeReturnLineId,
        returnLines.map((line) => line.id),
      ),
    );
  }

  private async findSalesOrderId(trx: DbTx, salesChannel: SalesChannel, channelOrderId: string): Promise<string> {
    const [row] = await trx
      .select({ id: wmsTables.salesOrders.id })
      .from(wmsTables.salesOrders)
      .where(
        and(
          eq(wmsTables.salesOrders.salesChannel, salesChannel),
          eq(wmsTables.salesOrders.channelOrderId, channelOrderId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError(`Sales order not found: ${salesChannel}/${channelOrderId}`);
    return row.id;
  }

  private async findExistingByChannelReturnId(trx: DbTx, channelReturnId: string, opts: { lock?: boolean } = {}) {
    const query = trx
      .select()
      .from(wmsTables.customerReturns)
      .where(eq(wmsTables.customerReturns.channelReturnId, channelReturnId))
      .limit(1);
    const [row] = opts.lock ? await query.for('update') : await query;
    return row;
  }

  private async findByChannelReturnId(trx: DbTx, channelReturnId: string, opts: { lock?: boolean } = {}) {
    const row = await this.findExistingByChannelReturnId(trx, channelReturnId, opts);
    if (!row) throw new NotFoundError(`Customer return not found: channel ${channelReturnId}`);
    return row;
  }

  /** 줄마다 굳은 구성(SKU × 판매 1개당 수량)을 읽는다. 구성이 없는 줄이 있으면 BadRequestError. */
  private async resolveCompositions(
    trx: DbTx,
    lines: Array<{ salesOrderLineId: string; channelOrderItemId: string }>,
  ): Promise<Map<string, Array<{ skuId: string; qtyPerUnit: number }>>> {
    const rows = await trx
      .select({
        salesOrderLineId: wmsTables.salesOrderLineCompositions.salesOrderLineId,
        skuId: wmsTables.salesOrderLineCompositions.skuId,
        qtyPerUnit: wmsTables.salesOrderLineCompositions.qtyPerUnit,
      })
      .from(wmsTables.salesOrderLineCompositions)
      .where(
        inArray(
          wmsTables.salesOrderLineCompositions.salesOrderLineId,
          lines.map((line) => line.salesOrderLineId),
        ),
      );
    const bySalesLine = new Map<string, Array<{ skuId: string; qtyPerUnit: number }>>();
    for (const row of rows) {
      const list = bySalesLine.get(row.salesOrderLineId) ?? [];
      list.push({ skuId: row.skuId, qtyPerUnit: row.qtyPerUnit });
      bySalesLine.set(row.salesOrderLineId, list);
    }
    const missing = lines.find((line) => !bySalesLine.has(line.salesOrderLineId));
    if (missing) {
      throw new BadRequestError(`Return line has no SKU composition: ${missing.channelOrderItemId}`);
    }
    return bySalesLine;
  }

  private async resolveLines(
    trx: DbTx,
    salesOrderId: string,
    items: ChannelReturnRequestedPayload['items'],
  ): Promise<Array<{ salesOrderLineId: string; channelOrderItemId: string; quantity: number }>> {
    const rows = await trx
      .select({
        id: wmsTables.salesOrderLines.id,
        channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        quantity: wmsTables.salesOrderLines.quantity,
      })
      .from(wmsTables.salesOrderLines)
      .where(
        and(
          eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId),
          inArray(
            wmsTables.salesOrderLines.channelOrderItemId,
            items.map((item) => item.channelOrderItemId),
          ),
        ),
      );
    const byItem = new Map(rows.map((row) => [row.channelOrderItemId, row]));

    return items.map((item) => {
      const line = byItem.get(item.channelOrderItemId);
      if (!line) {
        throw new BadRequestError(`Unknown channel order item for return: ${item.channelOrderItemId}`);
      }
      if (item.quantity > line.quantity) {
        throw new BadRequestError(
          `Return quantity ${item.quantity} exceeds line quantity ${line.quantity}: ${item.channelOrderItemId}`,
        );
      }
      return { salesOrderLineId: line.id, channelOrderItemId: item.channelOrderItemId, quantity: item.quantity };
    });
  }
}
