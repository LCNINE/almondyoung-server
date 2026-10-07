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
import { ChannelCancelSettler } from '../channel-cancel-request/channel-cancel-settler';
import { diffChannelSnapshot, isDecrease, removesAllLines } from './channel-order-diff';
import { errorDetail, isDomainRefusal, toAddressBlocker } from './channel-change-blockers';
import { suppressDismissed } from './channel-change-dismissal';
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

/**
 * 셀메이트 과도기에 `scripts/sellmate/mark-shipped-from-csv.ts` 가 직접 찍는 출고 표시(#1016 15번 행).
 * core 출고 기록이 없어도 물건은 이미 떠났다 — `isFullyShipped` 는 core 출고지시·박스만 보므로 이걸 못 본다.
 * 지금 이 status 를 쓰는 코드는 없다. 생기더라도 «떠났다» 는 뜻은 같다.
 */
const MARKED_SHIPPED_STATUSES: ReadonlySet<string> = new Set(['shipped', 'delivered']);
const MARKED_SHIPPED_DETAIL = 'sales order marked shipped';

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
    private readonly cancelSettler: ChannelCancelSettler,
  ) {}

  async handle(salesOrderId: string, payload: OrderModifiedPayload, sourceEventId: string, tx: DbTx): Promise<void> {
    const order = await this.reader.lockEffectiveOrder(salesOrderId, tx);
    if (!order) throw new Error(`Sales order ${salesOrderId} vanished after resolve`);
    // 열린 채널 취소 요청이 먹는 감소는 5번 규칙을 타지 않는다 — 우리가 요청한 변경이다(#1016 35번 §5.4).
    const deltas = await this.cancelSettler.settleModified(
      salesOrderId,
      diffChannelSnapshot(order, payload.snapshot),
      payload.snapshot.cancelRequests ?? [],
      payload.modifiedAt,
      tx,
    );
    const amendmentId = randomUUID();
    const allRemoved = removesAllLines(order, deltas);
    const recorded: RecordedChannelDelta[] = [];
    for (const delta of deltas) {
      recorded.push(await this.settle(order, delta, { amendmentId, allRemoved, occurredAt: payload.modifiedAt }, tx));
    }
    // 운영자가 무시한 차이와 똑같은 차이면 pending 을 다시 띄우지 않는다(#1016 6번 행 §6).
    const dismissed = await this.reader.latestDismissedChannelDeltas(salesOrderId, tx);
    const kept = suppressDismissed(recorded, dismissed);
    await this.amendments.recordChannelAmendment(
      {
        id: amendmentId,
        salesOrderId,
        deltas: kept,
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
    const markedShipped = MARKED_SHIPPED_STATUSES.has(order.status);
    if (delta.type === 'shipping_address_change') {
      if (markedShipped) {
        return {
          ...delta,
          outcome: 'pending',
          blockers: [{ code: 'SHIPMENT_NOT_REVISABLE', detail: MARKED_SHIPPED_DETAIL }],
        };
      }
      return this.tryAddress(order, delta, ctx.amendmentId, tx);
    }
    if (isDecrease(delta)) {
      if (ctx.allRemoved) return { ...delta, outcome: 'pending', blockers: [{ code: 'ALL_LINES_REMOVED' }] };
      // V1 cancelPartial 은 판매주문 status 를 보지 않는다 — 시도하면 이미 나간 수량을 «안 나간 몫» 으로 줄이고
      // awaiting_matching 백로그를 pending 으로 되돌려 매칭을 다시 시도시킨다.
      if (markedShipped) {
        return {
          ...delta,
          outcome: 'pending',
          blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: MARKED_SHIPPED_DETAIL }],
        };
      }
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
      // 전량 출고 — 소포는 이미 옛 주소로 떠났다. 판매주문만 고치면 «반영됨» 으로 보여 정정이 묻힌다.
      if (await this.reader.isFullyShipped(order.id, sp)) {
        throw new Refused({ code: 'SHIPMENT_NOT_REVISABLE', detail: 'already shipped' });
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

  /**
   * 스펙 §7.2 — 기존 취소를 그대로 시도. 그 자리에서 끝나지 않으면(박스 대기, 출고분 회수 이관) 되돌린다
   * (R1: 새 대기·회수를 만들지 않는다).
   */
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
      const followUp = await this.reader.cancellationNeedsFollowUp(order.id, sourceEventId, sp);
      if (followUp) throw new Refused({ code: 'CANCEL_NOT_IMMEDIATE', detail: followUp });
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
