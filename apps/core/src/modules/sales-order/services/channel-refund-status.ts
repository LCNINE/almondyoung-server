import type { StoreRefundStatus } from '../dto/store-order-actions.dto';
import type { SettlementMode, SettlementPhase } from '../channel-cancel-request/channel-cancel-request.types';
import type { WalletRefundListItem } from './wallet-refund.client';

/** 채널 주문 취소 요청 하나의 정산 — 최근 순으로 넘긴다 */
export type ChannelSettlementFact =
  | { status: 'settling'; mode: SettlementMode; phase: SettlementPhase }
  | { status: 'applied'; mode: SettlementMode };

/** 수동 정산이 끝난 뒤 wallet 의 송금 대기 행. unknown = wallet 이 답하지 않았다 */
export type ManualTransfer = 'pending' | 'done' | 'unknown';

/**
 * 수동 정산은 Medusa 에 Refund 행이 생겨 «수집된 환불»로 보이지만, 실제 송금은 운영자가 [완료 처리]를 눌러야 끝난다(스펙 §8.2).
 * 정산 중인 것이 없고 수동으로 끝난 정산이 «하나라도» 있으면 wallet 에 묻는다 — 자동으로 끝난 요청이 더 최근이어도 앞선 수동 송금은 남아 있을 수 있다.
 */
export function needsManualTransferCheck(facts: ChannelSettlementFact[]): boolean {
  if (facts.some((f) => f.status === 'settling')) return false;
  return facts.some((f) => f.status === 'applied' && f.mode === 'manual');
}

export function manualTransferOf(refunds: WalletRefundListItem[] | null): ManualTransfer {
  if (refunds === null) return 'unknown';
  return refunds.some((r) => r.execution === 'MANUAL' && r.status === 'PENDING') ? 'pending' : 'done';
}

/**
 * 채널 주문의 정산 → 고객 환불 배지(스펙 §8.2, #1016 36번 재설계 판정 5). null = 정산이 할 말이 없다 — 부르는 쪽이 지금 도출(수집된 환불 등)을 쓴다.
 * 고객에게는 지연과 거절을 구분하지 않는다(§5.2). wallet 을 모르면 «아직 송금 전»이 안전하다 — «완료»라고 했다가 돈이 안 갔으면 거짓이다.
 */
export function channelRefundStatus(
  facts: ChannelSettlementFact[],
  manualTransfer: ManualTransfer | null,
): StoreRefundStatus | null {
  const open = facts.filter((f): f is Extract<ChannelSettlementFact, { status: 'settling' }> => f.status === 'settling');
  // 거절 > 수동 > 지연(나이) 순 — 운영자는 30분이 지나야 수동으로 돌릴 수 있어, 나이 기준 지연이 먼저면 «계좌 송금 예정»이 가려진다
  if (open.some((f) => f.phase === 'refused')) return 'delayed';
  if (open.some((f) => f.mode === 'manual')) return 'transfer_pending';
  if (open.some((f) => f.phase === 'delayed')) return 'delayed';
  if (open.length > 0) return 'pending';
  if (needsManualTransferCheck(facts) && manualTransfer !== 'done') return 'transfer_pending';
  return null;
}
