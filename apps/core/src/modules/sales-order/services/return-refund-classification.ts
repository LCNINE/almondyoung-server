import { WalletRefundOutcome } from './wallet-refund.client';

/**
 * Wallet 환불 결과 → attempt 행 전이 결정 (순수).
 * - succeeded: 확정 성공(success / already_refunded) → 반품 completed.
 * - failed:    확정 실패(determinate 4xx / 200-OK refund FAILED) → attempt failed, 다음 재시도가 N+1 새 key.
 * - pending:   불확정(5xx / in_flight / wallet_unavailable / partial_pending / no_intent_id)
 *              → attempt pending 유지, 같은 key 재생 (규율 1·3: N 증가 금지).
 */
export type RefundAttemptDecision = 'succeeded' | 'failed' | 'pending';

export function classifyRefundOutcome(outcome: WalletRefundOutcome): RefundAttemptDecision {
  switch (outcome.kind) {
    case 'success':
    case 'already_refunded':
      return 'succeeded';
    case 'failed':
      return outcome.determinate ? 'failed' : 'pending';
    case 'partial_pending':
    case 'in_flight':
    case 'wallet_unavailable':
    case 'no_intent_id':
      return 'pending';
  }
}
