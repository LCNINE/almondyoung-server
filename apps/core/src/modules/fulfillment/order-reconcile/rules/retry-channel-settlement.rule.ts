// apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { ChannelCancelRequestService } from '../../../sales-order/channel-cancel-request/channel-cancel-request.service';
import { OrderReconcileRule, OrderReconcileSituation, ReconcileActResult } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';

/**
 * #1016 36번 행(재설계 §7.3): 확정된 채널 취소의 정산이 끝나지 않았다 — 같은 requestId·refundMode 로 명령을 다시 낸다.
 * 일시 실패·명령/사실 유실·channel-adapter 결함을 한 곳에서 잡는다. 영구 거절(settle_refused)은 칸에 없다 — 운영자가 고른다.
 */
@Injectable()
export class RetryChannelSettlementRule implements OrderReconcileRule {
  readonly name = 'retry-channel-settlement';
  readonly row = 36;
  readonly subject = 'order' as const;
  // 관찰로 배포한다. 실행 전환은 channel-adapter 의 일시 실패 ack 전환과 같은 배포(PR 6) — 그 전까지 일시 실패는 Kafka 재시도·DLQ 를 탄다
  readonly mode: ReconcileMode = 'observe';
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
