import type { RefundAttempt } from '../../../modules/almond-payment/refund-data';
import type { WalletRefundListItem } from '../../../modules/almond-payment/wallet-refund-list';
import { EXTERNAL_REFUND_NOTE_PREFIX } from '../partial-cancel/external-refund';

export type WalletRefundBooking = { walletRefundId: string; amount: number; note: string };
/**
 * bookings — 장부에 넣을 것. inFlight — 장부에 없는 자동(AUTO) PENDING: PG 결과가 아직 안 났다(넣지 않는다).
 * inFlight 도 bookings 와 같은 규칙으로 메모를 정해 둔다 — 끝나면 같은 메모로 들어가고, «이 경로로 돈이 나갔을 수 있나» 판정이 읽는다.
 */
export type WalletRefundPlan = { bookings: WalletRefundBooking[]; inFlight: WalletRefundBooking[] };

/**
 * 장부 맞추기(#1016 36번 재설계 §6.2): wallet 환불 중 Medusa 장부에 없는 것을 어떤 메모로 넣을지 정한다.
 * - 넣는 것은 SUCCEEDED 와 수동(MANUAL) PENDING(송금 대기 — wallet 남은 금액에서 이미 빠졌다). FAILED 는 돈이 안 움직였다
 * - 자동(AUTO) PENDING 은 넣지 않고 inFlight 로 돌려준다(D8 — 스펙 §6.2 문면의 «SUCCEEDED·PENDING» 과 다르다). wallet 은 PG 를
 *   부르기 «전»에 PENDING 행을 커밋하므로, 응답이 끊기거나 wallet 이 죽으면 행이 PENDING 으로 남는다. 그걸 넣으면 «캡처 − 환불»이
 *   0 이 돼 PG 가 실패해도 «환불 완료»로 취소된다. 부르는 쪽(reconcileWalletRefunds)이 일시 실패로 멈춘다
 * - 장부에 있는 것은 넣지 않는다: 결제 data.walletRefundIds(provider·투영이 쌓는다) 또는 `wallet:<id>` 메모
 * - 시도 표식이 남아 있으면 장부에 없는 MEDUSA_REFUND 를 그 메모로(그 시도의 응답 유실) — 표식 금액까지만, 만든 순서대로
 * - 나머지는 `wallet:<id>` — Medusa 밖 환불(37번 판정이 «외부 환불»로 읽는다), 표식 없는 유실분도 여기로
 */
export function planWalletRefundBookings(input: {
  walletRefunds: WalletRefundListItem[];
  bookedWalletRefundIds: string[];
  attempt: RefundAttempt | null;
}): WalletRefundPlan {
  const booked = new Set(input.bookedWalletRefundIds);
  let attributable = input.attempt?.amount ?? 0;
  const plan: WalletRefundPlan = { bookings: [], inFlight: [] };
  const candidates = input.walletRefunds
    .filter((r) => (r.status === 'SUCCEEDED' || r.status === 'PENDING') && !booked.has(r.id) && Number.isInteger(r.amount) && r.amount > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const r of candidates) {
    let note = `${EXTERNAL_REFUND_NOTE_PREFIX}${r.id}`;
    if (input.attempt && r.reasonCode === 'MEDUSA_REFUND' && r.amount <= attributable) {
      attributable -= r.amount;
      note = input.attempt.note;
    }
    const inFlight = r.status === 'PENDING' && r.execution !== 'MANUAL';
    (inFlight ? plan.inFlight : plan.bookings).push({ walletRefundId: r.id, amount: r.amount, note });
  }
  return plan;
}
