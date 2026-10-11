import type { RefundAttempt } from '../../../modules/almond-payment/refund-data';
import type { WalletRefundListItem } from '../../../modules/almond-payment/wallet-refund-list';
import { EXTERNAL_REFUND_NOTE_PREFIX } from '../partial-cancel/external-refund';

export type WalletRefundBooking = { walletRefundId: string; amount: number; note: string };

const MOVED = new Set(['SUCCEEDED', 'PENDING']);

/**
 * 장부 맞추기(#1016 36번 재설계 §6.2): wallet 환불 중 Medusa 장부에 없는 것을 어떤 메모로 넣을지 정한다.
 * - SUCCEEDED·PENDING 만 — PENDING(송금 대기)은 wallet 남은 금액에서 이미 빠졌다. FAILED 는 돈이 안 움직였다
 * - 장부에 있는 것은 넣지 않는다: 결제 data.walletRefundIds(provider·투영이 쌓는다) 또는 `wallet:<id>` 메모
 * - 시도 표식이 남아 있으면 장부에 없는 MEDUSA_REFUND 를 그 메모로(그 시도의 응답 유실) — 표식 금액까지만, 만든 순서대로
 * - 나머지는 `wallet:<id>` — Medusa 밖 환불(37번 판정이 «외부 환불»로 읽는다), 표식 없는 유실분도 여기로
 */
export function planWalletRefundBookings(input: {
  walletRefunds: WalletRefundListItem[];
  bookedWalletRefundIds: string[];
  attempt: RefundAttempt | null;
}): WalletRefundBooking[] {
  const booked = new Set(input.bookedWalletRefundIds);
  let attributable = input.attempt?.amount ?? 0;
  return input.walletRefunds
    .filter((r) => MOVED.has(r.status) && !booked.has(r.id) && Number.isInteger(r.amount) && r.amount > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((r) => {
      if (input.attempt && r.reasonCode === 'MEDUSA_REFUND' && r.amount <= attributable) {
        attributable -= r.amount;
        return { walletRefundId: r.id, amount: r.amount, note: input.attempt.note };
      }
      return { walletRefundId: r.id, amount: r.amount, note: `${EXTERNAL_REFUND_NOTE_PREFIX}${r.id}` };
    });
}
