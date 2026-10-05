import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { and, eq, notInArray } from 'drizzle-orm';
import type { OrderModifiedPayload, ShippingAddress } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentPlanningService } from '../../fulfillment/services/shipment-planning.service';
import { FULFILLMENT_SYSTEM_ACTOR_ID, SalesOrdersService } from '../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { ChannelOrderChangeReader, FINISHED_FULFILLMENT_STATUSES } from './channel-order-change.reader';
import { diffChannelSnapshot, isDecrease, removesAllLines } from './channel-order-diff';
import { errorDetail, isDomainRefusal, toAddressBlocker } from './channel-change-blockers';
import {
  CHANNEL_ORDER_MODIFIED_REASON,
  ChannelBlocker,
  ChannelDelta,
  EffectiveSalesOrder,
  QuantityCorrectionDelta,
  RecordedChannelDelta,
  ShippingAddressChangeDelta,
} from './channel-order-change.types';

const CHANNEL_ACTOR = { id: FULFILLMENT_SYSTEM_ACTOR_ID, roles: ['master'] };

/** savepoint 를 되돌리려고 던지는 표지. 밖으로 새지 않는다. */
class Refused extends Error {
  constructor(readonly blocker: ChannelBlocker) {
    super(blocker.code);
  }
}

@Injectable()
export class ChannelOrderChangeManager {
  constructor(
    private readonly reader: ChannelOrderChangeReader,
    private readonly salesOrders: SalesOrdersService,
    private readonly amendments: SalesOrderAmendmentsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async handle(salesOrderId: string, payload: OrderModifiedPayload, sourceEventId: string, tx: DbTx): Promise<void> {
    const order = await this.reader.lockEffectiveOrder(salesOrderId, tx);
    if (!order) throw new Error(`Sales order ${salesOrderId} vanished after resolve`);
    const deltas = diffChannelSnapshot(order, payload.snapshot);
    const amendmentId = randomUUID();
    const allRemoved = removesAllLines(order, deltas);
    const recorded: RecordedChannelDelta[] = [];
    for (const delta of deltas) {
      recorded.push(await this.settle(order, delta, { amendmentId, allRemoved, occurredAt: payload.modifiedAt }, tx));
    }
    await this.amendments.recordChannelAmendment(
      {
        id: amendmentId,
        salesOrderId,
        deltas: recorded,
        occurredAt: new Date(payload.modifiedAt),
        sourceEventId,
        salesChannel: payload.salesChannel,
        externalOrderId: payload.externalOrderId,
      },
      tx,
    );
  }

  private async settle(
    order: EffectiveSalesOrder,
    delta: ChannelDelta,
    ctx: { amendmentId: string; allRemoved: boolean; occurredAt: string },
    tx: DbTx,
  ): Promise<RecordedChannelDelta> {
    if (delta.type === 'shipping_address_change') return this.tryAddress(order, delta, ctx.amendmentId, tx);
    if (isDecrease(delta)) {
      if (ctx.allRemoved) return { ...delta, outcome: 'pending', blockers: [{ code: 'ALL_LINES_REMOVED' }] };
      return this.tryDecrease(order, delta, ctx, tx);
    }
    if (delta.type === 'unmatched_line') {
      return { ...delta, outcome: 'pending', blockers: [{ code: 'LINE_IDENTITY_MISSING' }] };
    }
    return { ...delta, outcome: 'pending', blockers: [{ code: 'OUT_OF_SCOPE' }] };
  }

  /** 스펙 §7.1 — 판매주문·출고지시·남은 박스를 한 savepoint 에서. 하나라도 거절되면 전부 되돌린다. */
  private async tryAddress(
    order: EffectiveSalesOrder,
    delta: ShippingAddressChangeDelta,
    amendmentId: string,
    tx: DbTx,
  ): Promise<RecordedChannelDelta> {
    const planning = this.moduleRef.get(ShipmentPlanningService, { strict: false });
    const refusal = await this.attempt(tx, async (sp) => {
      if (await this.reader.hasDropShipInProgress(order.id, sp)) {
        throw new Refused({ code: 'SHIPMENT_NOT_REVISABLE', detail: 'drop_ship already handed to supplier' });
      }
      await this.updateOrderAddress(order.id, delta.after, sp);
      for (const shipmentId of await this.reader.remainingShipmentIds(order.id, sp)) {
        try {
          await planning.reviseRecipientFromChannel(
            shipmentId,
            order.id,
            delta.after,
            `channel-order-change:${amendmentId}:${shipmentId}`,
            CHANNEL_ACTOR,
            sp,
          );
        } catch (error) {
          if (!isDomainRefusal(error)) throw error;
          throw new Refused(toAddressBlocker(error, shipmentId));
        }
      }
    });
    return refusal ? { ...delta, outcome: 'pending', blockers: [refusal] } : { ...delta, outcome: 'applied' };
  }

  /** 스펙 §7.2 — 기존 취소를 그대로 시도. 그 자리에서 끝나지 않으면 되돌린다(R1: 새 대기를 만들지 않는다). */
  private async tryDecrease(
    order: EffectiveSalesOrder,
    delta: QuantityCorrectionDelta,
    ctx: { amendmentId: string; occurredAt: string },
    tx: DbTx,
  ): Promise<RecordedChannelDelta> {
    const sourceEventId = `${ctx.amendmentId}:${delta.salesOrderLineId}`;
    const refusal = await this.attempt(tx, async (sp) => {
      try {
        await this.salesOrders.cancel(
          order.id,
          {
            lines: [
              { salesOrderLineId: delta.salesOrderLineId, quantity: delta.quantityBefore - delta.correctedQuantity },
            ],
            cancelledBy: 'channel',
            reasonCode: CHANNEL_ORDER_MODIFIED_REASON,
            occurredAt: ctx.occurredAt,
            // walletRefund 를 넘기지 않는다 — 채널 변경의 환불은 채널이 한다(스펙 R6).
            metadata: { sourceEventId },
          },
          sp,
        );
      } catch (error) {
        if (!isDomainRefusal(error)) throw error;
        throw new Refused({ code: 'CANCEL_NOT_IMMEDIATE', detail: errorDetail(error) });
      }
      if (await this.reader.cancellationLeftPendingShipment(order.id, sourceEventId, sp)) {
        throw new Refused({ code: 'CANCEL_NOT_IMMEDIATE', detail: 'shipment cancellation would wait' });
      }
    });
    return refusal ? { ...delta, outcome: 'pending', blockers: [refusal] } : { ...delta, outcome: 'applied' };
  }

  /** 판매주문과 끝나지 않은 출고지시의 배송지. `shipping_address_hash` 는 건드리지 않는다(스펙 §7.1 2). */
  private async updateOrderAddress(salesOrderId: string, address: ShippingAddress, tx: DbTx): Promise<void> {
    const now = new Date();
    await tx
      .update(wmsTables.salesOrders)
      .set({ shippingAddress: address, updatedAt: now })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({ shippingAddress: address, updatedAt: now })
      .where(
        and(
          eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId),
          notInArray(wmsTables.fulfillmentOrders.status, [...FINISHED_FULFILLMENT_STATUSES]),
        ),
      );
  }

  /**
   * savepoint 하나. 성공이면 null. `Refused`(도메인 거절 — `isDomainRefusal` 을 통과한 HttpException·
   * ApplicationException 과 직배 가드)면 savepoint 만 되돌리고 그 사유를 돌려준다. 그 밖의 모든 예외
   * (DB 교착·잠금 시간 초과·직렬화 실패, 버그)는 그대로 던져 바깥 트랜잭션을 되돌리고 재시도시킨다(스펙 §11).
   */
  private async attempt(tx: DbTx, fn: (sp: DbTx) => Promise<void>): Promise<ChannelBlocker | null> {
    try {
      await tx.transaction(async (sp) => fn(sp));
      return null;
    } catch (error) {
      if (error instanceof Refused) return error.blocker;
      throw error;
    }
  }
}
