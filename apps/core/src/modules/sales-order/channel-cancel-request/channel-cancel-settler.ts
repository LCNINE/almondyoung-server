import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { OrderModifiedCancelRequest } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../services/sales-orders.service';
import { errorDetail, isDomainRefusal } from '../channel-order-change/channel-change-blockers';
import type { ChannelDelta } from '../channel-order-change/channel-order-change.types';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import { takeRequestedDecreases, takeRequestedIncreases } from './channel-cancel-match';
import {
  CHANNEL_CANCEL_REQUEST_REASON,
  CancelRequestMetadata,
  Settlement,
  readCancelRequestLines,
  readCancelRequestMetadata,
} from './channel-cancel-request.types';

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;

/**
 * 채널 취소 확정 (#1016 35번, 스펙 §5.4). 성공 사실은 따로 오지 않는다 — 재수집된 `OrderCancelled`/`OrderModified` 가 곧 사실이다.
 * 부분취소는 채널의 진행 기록(`snapshot.cancelRequests`)으로 «수정됨 · 환불 미완»과 «끝남»을 가른다(계획 단계 발견 1).
 * 부르는 쪽이 판매주문을 잠근 트랜잭션 안에서 부른다.
 * 정산 중(settling) 행은 물리 적용이 끝난 요청이다 — 종결만 하고 다시 적용하지 않는다(#1016 36번 재설계 §7.3). 옛 requested 행 분기가 먼저 돈다.
 */
@Injectable()
export class ChannelCancelSettler {
  private readonly logger = new Logger(ChannelCancelSettler.name);

  constructor(
    private readonly reader: ChannelCancelRequestReader,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  /**
   * 열린 부분취소 요청이 먹은 감소를 반영하고, 먹지 않은 델타를 돌려준다 — 그것만 5번 규칙을 탄다.
   * 정산 중 부분취소는 채널 진행 기록이 «환불 끝»이면 닫고, 기록이 없으면(채널이 아직 안 줄였다) 요청분의 «늘어남»을 먹는다(D10).
   */
  async settleModified(
    salesOrderId: string,
    deltas: ChannelDelta[],
    progress: OrderModifiedCancelRequest[],
    occurredAt: string,
    tx: DbTx,
  ): Promise<ChannelDelta[]> {
    let rest = await this.settleLegacyModified(salesOrderId, deltas, progress, occurredAt, tx);
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.scope !== 'partial') continue;
      const record = progress.find((p) => p.requestId === row.id);
      if (record?.stage === 'refunded') {
        await this.write(row.id, 'applied', { ...settled(meta), outcome: outcomeOf(record) }, tx);
        continue;
      }
      if (!record) {
        const taken = takeRequestedIncreases(readCancelRequestLines(row.deltas), rest);
        if (taken.matched) rest = taken.rest;
      }
      // edited — 채널은 줄였고 환불이 남았다. 정산 중 그대로(실패 사실이 사유를 싣는다)
    }
    return rest;
  }

  /** 옛 requested 행(PR 5 전) — 수집 때 물리 적용하고 진행 기록으로 닫는다(#1016 35번). */
  private async settleLegacyModified(
    salesOrderId: string,
    deltas: ChannelDelta[],
    progress: OrderModifiedCancelRequest[],
    occurredAt: string,
    tx: DbTx,
  ): Promise<ChannelDelta[]> {
    const open = await this.reader.findOpen(salesOrderId, tx, { lock: true });
    if (!open) return deltas;
    const meta = readCancelRequestMetadata(open.metadata);
    if (meta.request.scope !== 'partial') return deltas;
    const record = progress.find((p) => p.requestId === open.id);
    if (!record) return deltas;

    let rest = deltas;
    let appliedAt = meta.request.appliedAt;
    if (!appliedAt) {
      const lines = readCancelRequestLines(open.deltas);
      const taken = takeRequestedDecreases(lines, deltas);
      if (!taken.matched) {
        await this.supersede(open, meta, 'CHANNEL_CHANGE_MISMATCH', tx);
        return deltas;
      }
      const refusal = await this.applyPhysical(salesOrderId, open.id, lines, occurredAt, tx);
      if (refusal) {
        // 같은 델타가 5번 규칙에서 다시 거절돼 «반영 대기 변경»(CANCEL_NOT_IMMEDIATE)에 남는다 — 운영자가 거기서 본다.
        await this.supersede(open, meta, 'APPLY_REFUSED', tx, refusal);
        return deltas;
      }
      appliedAt = new Date().toISOString();
      rest = taken.rest;
    }

    const request = { ...meta.request, appliedAt };
    if (record.stage === 'refunded') {
      // 닫힌 요청은 «수정됨» 표지를 들고 있지 않는다(stage 는 optional 이라 delete 가능).
      delete request.stage;
      await this.write(
        open.id,
        'applied',
        {
          ...meta,
          request,
          outcome: outcomeOf(record),
        },
        tx,
      );
    } else {
      await this.write(open.id, 'requested', { ...meta, request: { ...request, stage: 'edited' } }, tx);
    }
    return rest;
  }

  /** 수집된 전체취소(`OrderCancelled`) — 열린 전체 요청은 applied, 부분 요청은 덮였다(스펙 §9-7·§9-12). */
  async settleCancelled(salesOrderId: string, tx: DbTx): Promise<void> {
    const open = await this.reader.findOpen(salesOrderId, tx, { lock: true });
    if (open) {
      const meta = readCancelRequestMetadata(open.metadata);
      if (meta.request.scope === 'full') await this.write(open.id, 'applied', meta, tx);
      else await this.supersede(open, meta, 'CHANNEL_FULL_CANCEL', tx);
    }
    // 정산 중 — 전체는 끝났고, 부분은 전체취소가 «캡처 − 환불»을 다 돌려줘 덮였다(스펙 §7.3)
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.scope === 'full') await this.write(row.id, 'applied', settled(meta), tx);
      else await this.supersede(row, meta, 'CHANNEL_FULL_CANCEL', tx);
    }
  }

  private async applyPhysical(
    salesOrderId: string,
    requestId: string,
    lines: Array<{ salesOrderLineId: string; quantity: number }>,
    occurredAt: string,
    tx: DbTx,
  ): Promise<string | null> {
    try {
      await tx.transaction(async (sp) => {
        await this.salesOrders.cancel(
          salesOrderId,
          {
            lines: lines.map((line) => ({ salesOrderLineId: line.salesOrderLineId, quantity: line.quantity })),
            cancelledBy: 'channel',
            reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
            occurredAt,
            // 같은 키라 재처리는 기존 취소를 돌려받는다(V2 replay). walletRefund 를 넘기지 않는다 — 환불은 채널이 했다.
            metadata: { sourceEventId: `cancel-request:${requestId}` },
          },
          sp,
        );
      });
      return null;
    } catch (error) {
      if (!isDomainRefusal(error)) throw error;
      this.logger.warn(`[CancelRequest] ${requestId} physical cancel refused: ${errorDetail(error)}`);
      return errorDetail(error);
    }
  }

  private async supersede(
    row: AmendmentRow,
    meta: CancelRequestMetadata,
    reason: 'CHANNEL_CHANGE_MISMATCH' | 'APPLY_REFUSED' | 'CHANNEL_FULL_CANCEL',
    tx: DbTx,
    detail?: string,
  ): Promise<void> {
    this.logger.warn(`[CancelRequest] ${row.id} superseded: ${reason}${detail ? ` (${detail})` : ''}`);
    await this.write(row.id, 'superseded', { ...meta, supersededReason: reason }, tx);
  }

  private async write(
    id: string,
    status: 'requested' | 'applied' | 'superseded',
    metadata: CancelRequestMetadata,
    tx: DbTx,
  ): Promise<void> {
    await tx
      .update(wmsTables.salesOrderAmendments)
      .set({ status, metadata, updatedAt: new Date() })
      .where(eq(wmsTables.salesOrderAmendments.id, id));
  }
}

function outcomeOf(record: OrderModifiedCancelRequest): NonNullable<CancelRequestMetadata['outcome']> {
  return {
    refundAmount: record.refundAmount,
    shippingCharge: record.shippingCharge,
    shippingRefund: record.shippingRefund,
    shippingNotAdjusted: record.shippingNotAdjusted,
    ...(record.externalRefundApplied ? { externalRefundApplied: record.externalRefundApplied } : {}),
  };
}

/** 정산이 끝났다 — 마지막 실패는 더 이상 사실이 아니다(PR 3 판정 2). 방식(mode)은 남긴다: actions API 가 수동 송금 여부를 묻는다 */
function settled(meta: CancelRequestMetadata): CancelRequestMetadata {
  if (!meta.settlement) return meta;
  const settlement: Settlement = { state: meta.settlement.state, mode: meta.settlement.mode, since: meta.settlement.since };
  return { ...meta, settlement };
}
