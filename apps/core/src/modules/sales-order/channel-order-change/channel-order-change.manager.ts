import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { OrderModifiedPayload, ShippingAddress } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentPlanningService } from '../../fulfillment/services/shipment-planning.service';
import { FULFILLMENT_SYSTEM_ACTOR_ID } from '../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { ChannelOrderChangeReader, FINISHED_FULFILLMENT_STATUSES } from './channel-order-change.reader';
import { ChannelCancelSettler } from '../channel-cancel-request/channel-cancel-settler';
import { diffChannelSnapshot, isDecrease, removesAllLines } from './channel-order-diff';
import { isDomainRefusal, toAddressBlocker } from './channel-change-blockers';
import { OrderCancellation } from '../order-cancellation/order-cancellation';
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
export const PRINT_HELD_FOR_DECREASE =
  'channel decreased quantity before the print was ordered — confirm quantity, then proceed';

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
    private readonly amendments: SalesOrderAmendmentsService,
    private readonly moduleRef: ModuleRef,
    private readonly cancelSettler: ChannelCancelSettler,
    private readonly cancellation: OrderCancellation,
  ) {}

  async handle(salesOrderId: string, payload: OrderModifiedPayload, sourceEventId: string, tx: DbTx): Promise<void> {
    const order = await this.reader.lockEffectiveOrder(salesOrderId, tx);
    if (!order) throw new Error(`Sales order ${salesOrderId} vanished after resolve`);
    // 정산 중 채널 취소 요청의 거울(채널이 아직 안 줄인 «늘어남»)은 5번 규칙을 타지 않는다 — 확정 때 이미 적용한 변경이다(#1016 36번 재설계 D10).
    const fullDiff = diffChannelSnapshot(order, payload.snapshot);
    // 요청은 감소를 먹지 않는다 — core 는 확정 때 이미 줄였으니 감소는 유효 수량에 들어 있어 diff 에 «감소»로 나오지 않는다.
    // 정산 중 부분 요청은 채널이 아직 취소를 반영하지 않았을 때의 거울 «늘어남»만 흡수한다(settleModified).
    // 「전 라인 제거」 판정은 그 흡수 «전» 전체 diff 로 한다.
    // 알려진 가장자리(범위 밖): 채널이 우리 부분취소를 반영하기 전에 남은 줄을 지우면 ALL_LINES_REMOVED 로 잡히지 않는다.
    const allRemoved = removesAllLines(order, fullDiff);
    const deltas = await this.cancelSettler.settleModified(
      salesOrderId,
      fullDiff,
      {
        cancelRequests: payload.snapshot.cancelRequests ?? [],
        orderCancelled: payload.snapshot.orderCancelled === true,
      },
      tx,
    );
    const amendmentId = randomUUID();
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
      // 아래 어느 길로든 인쇄 줄의 감소는 대기로 남아 운영자 몫이 된다. 그사이 원래 수량으로 주문되지 않게,
      // 거절이 되돌리는 savepoint 밖에서 아직 안 보낸 인쇄를 먼저 붙잡는다
      await this.holdUnsentPrint(delta.salesOrderLineId, tx);
      if (ctx.allRemoved) return { ...delta, outcome: 'pending', blockers: [{ code: 'ALL_LINES_REMOVED' }] };
      // cancelBeforeBoxingPartial 은 판매주문 status 를 보지 않는다 — 시도하면 이미 나간 수량을 «안 나간 몫» 으로 줄이고
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
      // 와우프레스 인쇄 주문은 받은 주소로 직배송된다. 판매주문만 고치면 «반영됨» 으로 보이고 인쇄물은 옛 주소로 간다
      if (await this.reader.hasPrintSentToVendor(order.id, sp)) {
        throw new Refused({ code: 'SHIPMENT_NOT_REVISABLE', detail: 'print order already sent to WowPress' });
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
   * (R1: 새 대기·회수를 만들지 않는다). 시도·되돌림(savepoint)은 커널이 한다 — 여기는 거절을 대기 사유로 옮길 뿐이다.
   */
  private async tryDecrease(
    order: EffectiveSalesOrder,
    delta: QuantityCorrectionDelta,
    ctx: { amendmentId: string; occurredAt: string },
    tx: DbTx,
  ): Promise<RecordedChannelDelta> {
    const outcome = await this.cancellation.notice(
      {
        source: 'channel_decrease',
        salesOrderId: order.id,
        line: { salesOrderLineId: delta.salesOrderLineId, quantity: delta.quantityBefore - delta.correctedQuantity },
        reasonCode: CHANNEL_ORDER_MODIFIED_REASON,
        occurredAt: ctx.occurredAt,
        sourceEventId: `${ctx.amendmentId}:${delta.salesOrderLineId}`,
      },
      tx,
    );
    return outcome.applied
      ? { ...delta, outcome: 'applied' }
      : { ...delta, outcome: 'pending', blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: outcome.refusal }] };
  }

  /** 아직 주문권을 쓰지 않은 인쇄만 운영자 확인(cancel_refused)으로 넘긴다. 이미 보낸 주문은 와우프레스에서 판단한다. */
  private async holdUnsentPrint(salesOrderLineId: string, tx: DbTx): Promise<void> {
    const t = wmsTables.printOrders;
    const now = new Date();
    await tx
      .update(t)
      .set({
        status: 'cancel_refused',
        cancelRefusedAt: now,
        cancelResolvedAt: null,
        cancelResolvedBy: null,
        lastError: PRINT_HELD_FOR_DECREASE,
        updatedAt: now,
      })
      .where(
        and(
          eq(t.salesOrderLineId, salesOrderLineId),
          inArray(t.status, ['pending', 'submitting', 'failed', 'unsupported']),
          isNull(t.orderAttemptedAt),
          isNull(t.vendorOrderNumber),
        ),
      );
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
