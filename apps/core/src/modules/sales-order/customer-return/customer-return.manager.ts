import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
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
import { enqueueSalesOrderClaimProgress } from '../common/claim-progress';
import { transitionCustomerReturn } from './customer-return-transition';

/**
 * 채널(Medusa) 반품 확정·취소 사실을 «반품 예정» 기록으로 옮긴다 (K8 PR5).
 * 같은 사실이 몇 번 와도 기록·줄·고객 이벤트는 한 번만 생긴다(N7).
 */
@Injectable()
export class CustomerReturnManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
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
      await trx.insert(wmsTables.customerReturnItems).values(
        lines.flatMap((line) =>
          (compositions.get(line.salesOrderLineId) ?? []).map((c) => ({
            customerReturnLineId: returnLineIdBySalesLine.get(line.salesOrderLineId) as string,
            skuId: c.skuId,
            qtyPerUnit: c.qtyPerUnit,
            expectedQty: line.quantity * c.qtyPerUnit,
          })),
        ),
      );
      await enqueueSalesOrderClaimProgress(this.coreOrders, trx, {
        salesOrderId,
        kind: 'return',
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
      // requested 가 먼저 온다(같은 파티션 키·같은 폴링 순서). 없으면 순서가 깨진 것 — 재시도하지 않는다
      const record = await this.findByChannelReturnId(trx, fact.returnId);
      if (record.status === 'cancelled') return { customerReturnId: record.id, changed: false };

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
      return { customerReturnId: record.id, changed: true };
    }, tx);
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

  private async findExistingByChannelReturnId(trx: DbTx, channelReturnId: string) {
    const [row] = await trx
      .select()
      .from(wmsTables.customerReturns)
      .where(eq(wmsTables.customerReturns.channelReturnId, channelReturnId))
      .limit(1);
    return row;
  }

  private async findByChannelReturnId(trx: DbTx, channelReturnId: string) {
    const row = await this.findExistingByChannelReturnId(trx, channelReturnId);
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
