import type { ReturnSettlementDeduction } from './plan-return-fees';

export type ReturnOffsets = {
  /** 선환불에서 이번 정산이 덜 낸 몫 */
  prepaidApplied: number;
  /** CS 가 적은 외부 환불에서 이번 정산이 덜 낸 몫 */
  externalRefundApplied: number;
  /** 넣을 상계 음수 크레딧 라인의 크기(양수). 0 이면 넣지 않는다 */
  offsetCreditLine: number;
  /** 깎인 차감. 보류를 요청했을 때만 hold 칸이 있다(PR 6 기록과 같은 모양을 지키게) */
  deduction: ReturnSettlementDeduction;
  refundAmount: number;
};

/**
 * 수령이 만든 «돌려줄 차액»(owed)을 채운다(K8 PR6b N3): 선환불 → 외부 상계 → 택배비(① 반품비 ② 깨짐 ③ 왕복) → 보류 차감.
 * 넘치는 몫은 깎는다 — 수령 «뒤»라 거절하면 반품이 received 에 갇힌다. 남은 것이 이번 정산 환불이다.
 *
 * 상계 크레딧 라인은 «크레딧이 붙은 몫»에만 넣는다(N6). 반품 요청이 열린 동안 낸 환불(선환불)은 크레딧 라인이 없어
 * 수령 전 차액(diffBeforeReceive)에 양수로 들어 있고, 수령이 만든 음수 차액과 저절로 상계된다. 반품 전 환불(외부 환불)은
 * +크레딧이 붙어 있어 −라인이 필요하다. 그래서 clamp(적용 합 − 수령 전 차액, 0, 적용 합).
 * room = 수령 뒤 floor(−차액): Medusa 는 음수 라인이 |차액| 을 넘으면 거절한다(부분취소의 room 과 같은 이유).
 */
export function applyReturnOffsets(input: {
  owed: number;
  room: number;
  diffBeforeReceive: number;
  prepaid: number;
  externalRefund: number;
  fees: ReturnSettlementDeduction;
  holdRequested: number;
}): ReturnOffsets {
  let left = Math.max(0, input.owed);
  const take = (want: number) => {
    const got = Math.min(Math.max(0, want), left);
    left -= got;
    return got;
  };
  const prepaidApplied = take(input.prepaid);
  const externalRefundApplied = take(input.externalRefund);
  const deduction: ReturnSettlementDeduction = {
    returnShipping: take(input.fees.returnShipping),
    freeShippingBreak: take(input.fees.freeShippingBreak),
    roundTrip: take(input.fees.roundTrip),
  };
  if (input.holdRequested > 0) deduction.hold = take(input.holdRequested);

  const applied = prepaidApplied + externalRefundApplied;
  const credited = Math.min(Math.max(0, applied - input.diffBeforeReceive), applied);
  return {
    prepaidApplied,
    externalRefundApplied,
    offsetCreditLine: Math.min(credited, Math.max(0, input.room)),
    deduction,
    refundAmount: left,
  };
}
