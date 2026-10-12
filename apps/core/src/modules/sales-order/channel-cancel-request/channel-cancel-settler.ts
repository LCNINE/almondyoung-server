import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { OrderModifiedCancelRequest } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { ChannelDelta } from '../channel-order-change/channel-order-change.types';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import { combineRequestLines, takeRequestedIncreases } from './channel-cancel-match';
import {
  CancelRequestLine,
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
 * 정산 중(settling) 행은 물리 적용이 끝난 요청이다 — 종결만 하고 다시 적용하지 않는다(#1016 36번 재설계 §7.3).
 */
@Injectable()
export class ChannelCancelSettler {
  private readonly logger = new Logger(ChannelCancelSettler.name);

  constructor(private readonly reader: ChannelCancelRequestReader) {}

  /**
   * 정산 중 요청을 채널 기록으로 닫고, 요청이 먹지 않은 델타를 돌려준다 — 그것만 5번 규칙을 탄다.
   * 정산 중 부분취소는 채널 진행 기록이 «환불 끝»이면 닫고, 기록이 없으면(채널이 아직 안 줄였다) 요청분의 «늘어남»을 먹는다(D10).
   * 채널이 주문을 취소했으면(`orderCancelled`) 정산 중 요청을 `OrderCancelled` 와 똑같이 닫는다 — 그 사실은 주문당 한 번만 오므로
   * 놓친 행에겐 재수집 스냅샷이 유일한 탈출구다(PR 6 판정 3).
   */
  async settleModified(
    salesOrderId: string,
    deltas: ChannelDelta[],
    channel: { cancelRequests: OrderModifiedCancelRequest[]; orderCancelled: boolean },
    tx: DbTx,
  ): Promise<ChannelDelta[]> {
    const progress = channel.cancelRequests;
    if (channel.orderCancelled) await this.closeSettlingByFullCancel(salesOrderId, tx);
    const rest = deltas;
    const unreflected: CancelRequestLine[] = [];
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.scope !== 'partial') continue;
      const record = progress.find((p) => p.requestId === row.id);
      if (record?.stage === 'refunded') {
        await this.write(row.id, 'applied', { ...settled(meta), outcome: outcomeOf(record) }, tx);
        continue;
      }
      if (!record) unreflected.push(...readCancelRequestLines(row.deltas));
      // edited — 채널은 줄였고 환불이 남았다. 정산 중 그대로(실패 사실이 사유를 싣는다)
    }
    if (unreflected.length === 0) return rest;
    // 채널이 아직 안 줄인 요청이 같은 줄에 여럿이면 diff 는 그 합을 «늘어남» 하나로 낸다(줄당 델타 하나) — 요청마다 따로 대조하면
    // 어느 것도 크기가 맞지 않아 이미 취소한 수량이 반영 대기 변경으로 새어 나간다. 판매 줄별로 합쳐 한 번에 먹는다(전부 맞을 때만).
    const taken = takeRequestedIncreases(combineRequestLines(unreflected), rest);
    return taken.matched ? taken.rest : rest;
  }

  /** 수집된 전체취소(`OrderCancelled`) — 정산 중 전체 요청은 끝났고, 부분 요청은 덮였다(스펙 §7.3) */
  async settleCancelled(salesOrderId: string, tx: DbTx): Promise<void> {
    await this.closeSettlingByFullCancel(salesOrderId, tx);
  }

  /** 정산 중 — 전체는 끝났고, 부분은 전체취소가 «캡처 − 환불»을 다 돌려줘 덮였다(스펙 §7.3) */
  private async closeSettlingByFullCancel(salesOrderId: string, tx: DbTx): Promise<void> {
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.scope === 'full') await this.write(row.id, 'applied', settled(meta), tx);
      else await this.supersede(row, meta, 'CHANNEL_FULL_CANCEL', tx);
    }
  }

  private async supersede(
    row: AmendmentRow,
    meta: CancelRequestMetadata,
    reason: 'CHANNEL_FULL_CANCEL',
    tx: DbTx,
  ): Promise<void> {
    this.logger.warn(`[CancelRequest] ${row.id} superseded: ${reason}`);
    await this.write(row.id, 'superseded', { ...meta, supersededReason: reason }, tx);
  }

  private async write(
    id: string,
    status: 'applied' | 'superseded',
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
