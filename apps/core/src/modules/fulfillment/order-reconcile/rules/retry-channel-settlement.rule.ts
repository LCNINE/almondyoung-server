// apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { ChannelCancelRequestService } from '../../../sales-order/channel-cancel-request/channel-cancel-request.service';
import { OrderReconcileRule, OrderReconcileSituation, ReconcileActResult } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';

/**
 * #1016 36번 행(재설계 §7.3): 확정된 채널 취소의 정산이 끝나지 않았다 — 같은 requestId·refundMode 로 명령을 다시 낸다.
 * 일시 실패·명령/사실 유실·channel-adapter 결함을 한 곳에서 잡는다. 영구 거절(settle_refused)은 칸에 없다 — 운영자가 고른다.
 * 실행 모드(PR 6): channel-adapter 는 일시 실패를 사실로 낸 뒤 ack 한다 — 다시 부르는 곳은 여기 하나다. 재발행은 Medusa 에서 멱등이고,
 * Medusa 가 이미 정산한 행은 재수집 스냅샷(orderCancelled·cancelRequests)이 닫는다(PR 6 판정 2·3). 백오프·포기는 틀 그대로(판정 4).
 */
@Injectable()
export class RetryChannelSettlementRule implements OrderReconcileRule {
  readonly name = 'retry-channel-settlement';
  readonly row = 36;
  readonly subject = 'order' as const;
  readonly mode: ReconcileMode = 'act';
  // 막 (다시) 시작한 정산은 SETTLEMENT_REISSUE_GRACE_MS(60초) 안이라 첫 평가가 늘 «할 일 없음»이다 — 10분이 아니라 1분 뒤에 다시 본다
  readonly idleRecheckMin = 1;
  readonly situation: OrderReconcileSituation = {
    stage: 'cancel_request',
    states: ['settle_in_progress', 'settle_delayed'],
  };

  constructor(private readonly cancelRequests: ChannelCancelRequestService) {}

  fingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    return this.cancelRequests.settlementFingerprint(salesOrderId, tx);
  }

  check(salesOrderId: string, tx: DbTx): Promise<boolean> {
    return this.cancelRequests.hasSettlementToReissue(salesOrderId, new Date(), tx);
  }

  async act(salesOrderId: string, tx: DbTx): Promise<ReconcileActResult> {
    return (await this.cancelRequests.reissueSettlements(salesOrderId, new Date(), tx)) > 0 ? 'acted' : 'noop';
  }
}
