import type { AdminMemberDetail } from '@/lib/api/domains/membership';
import { TOSS_BANKS } from '@/lib/constants/toss-banks';

/** 은행코드를 사람이 읽는 이름으로. 모르는 코드는 코드 그대로 — 송금할 때 대조할 수 있어야 한다. */
export function bankName(code: string): string {
  return TOSS_BANKS.find((bank) => bank.code === code)?.name ?? code;
}

type RefundDetail = Pick<
  AdminMemberDetail,
  | 'refundRequested'
  | 'refundCompleted'
  | 'eligibleRefundAmount'
  | 'hasPaymentIntent'
  | 'manualRefundAccount'
  | 'refundSettlement'
>;

export function manualRefundState(detail: RefundDetail | undefined) {
  // 계좌로 보내기 전에 결제관리(wallet) 쪽 사실을 먼저 본다 — 이미 나갔거나 확정만 남은 건에
  // 또 송금하면 돈이 두 번 나간다. null 은 '알 수 없음'이라 아무것도 단정하지 않는다.
  const settlement = detail?.refundSettlement ?? null;
  const requestedRefund = detail?.eligibleRefundAmount ?? 0;
  const pgAlreadyRefunded =
    !!settlement &&
    requestedRefund > 0 &&
    settlement.alreadyRefundedAmount >= requestedRefund;
  const pgConfirmPending = !!settlement && settlement.pendingRefundAmount > 0;
  // 결제한 적이 없는 계약(관리자 지급·이관)은 환불할 대상 자체가 없다.
  // `=== false` 로 좁힌다: 배포 과도기(admin-web 이 membership 보다 먼저 뜬 창)에는 이 필드가
  // undefined 로 오는데, `!undefined` 로 판정하면 정상 수동 송금 건까지 전부 "환불 대상 결제 없음"
  // 으로 뒤집혀 송금 완료 처리 버튼이 사라진다.
  const refundImpossible =
    !!detail &&
    detail.refundRequested &&
    !detail.refundCompleted &&
    detail.hasPaymentIntent === false;
  const account = detail?.manualRefundAccount;
  const where = account
    ? `${bankName(account.bank)} ${account.accountNumber} (${account.holderName})`
    : '고객 계좌';
  const label = pgAlreadyRefunded ? '완료로 정리' : '송금 완료 처리';
  // PG 로 이미 나간 건은 '송금 확인'이 아니라 '기록 정리'다. 같은 문구로 물으면 관리자가
  // 보내지 않아도 될 돈을 보내고 나서 누른다.
  const question = pgAlreadyRefunded
    ? `결제관리에서 이미 ${(settlement?.alreadyRefundedAmount ?? 0).toLocaleString('ko-KR')}원이 환불됐어요. 추가 송금 없이 완료로 정리할까요?`
    : `${where}로 ${requestedRefund.toLocaleString('ko-KR')}원을 실제로 송금했나요? 이 버튼은 돈을 보내지 않고 완료 기록만 남겨요.`;

  return {
    pgAlreadyRefunded,
    pgConfirmPending,
    refundImpossible,
    canComplete:
      !!detail?.refundRequested &&
      !detail.refundCompleted &&
      !pgConfirmPending &&
      !refundImpossible,
    label,
    question,
  };
}
