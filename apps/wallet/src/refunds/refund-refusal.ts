/**
 * wallet 이 환불 요청을 4xx 로 거절할 때의 본문 — `{ error, message, detail, retryable }`.
 *
 * error 는 옛 이름 그대로다: core WalletRefundClient 가 body.error 로 금액 초과류를 «이미 환불됨»으로 읽는다.
 * retryable 은 «같은 요청을 나중에 다시 보내면 될 수 있는가» — almond-payment 가 영구 거절과 일시 실패를 가른다(스펙 §6.4).
 * 코드를 더하면 이 표에 판정과 운영자 문장을 함께 적어야 컴파일된다.
 */
const REFUSALS = {
  // 금액 초과류: 호출자 장부와 wallet 이 어긋난 경합(동시 환불 등)이다. 장부를 맞춘 다음 시도가 남은 몫만 보낸다(스펙 §6.2)
  REFUND_AMOUNT_EXCEEDS_CHARGE: { retryable: true, message: '환불 금액이 결제 금액보다 큽니다.' },
  REFUND_AMOUNT_EXCEEDS_AVAILABLE: { retryable: true, message: '환불 금액이 환불할 수 있는 남은 금액보다 큽니다.' },
  REFUND_AMOUNT_EXCEEDS_TOTAL: {
    retryable: true,
    message: '환불 금액이 이 결제에서 환불할 수 있는 남은 금액보다 큽니다.',
  },
  // 결제수단·정책·데이터가 막는다 — 다시 보내도 같다
  REFUND_NOT_AUTOMATABLE: {
    retryable: false,
    message: '자동으로 환불할 수 없는 결제수단입니다. 고객에게 계좌를 받아 송금으로 환불해 주세요.',
  },
  MEMBERSHIP_REFUND_NOT_ALLOWED: { retryable: false, message: '멤버십 결제는 환불할 수 없습니다.' },
  CHARGE_NOT_FOUND: { retryable: false, message: '환불할 결제 내역을 찾을 수 없습니다.' },
  CHARGE_INTENT_MISMATCH: { retryable: false, message: '환불할 결제 내역이 이 결제와 맞지 않습니다.' },
  CHARGE_NOT_REFUNDABLE: { retryable: false, message: '아직 환불할 수 있는 상태의 결제가 아닙니다.' },
  PAYMENT_METHOD_NOT_FOUND: { retryable: false, message: '결제수단 정보를 찾을 수 없습니다.' },
  INTENT_NOT_FOUND: { retryable: false, message: '결제 정보를 찾을 수 없습니다.' },
  REFUNDABLE_CHARGE_NOT_FOUND: { retryable: false, message: '환불할 수 있는 결제 내역이 없습니다.' },
  // 결제사 응답이 끊긴 이전 환불(PROVIDER_EXCEPTION)을 같은 키로 다시 보내 확인했다. 이번 요청은 그 결과를 모른 채 계산됐으니
  // 장부를 다시 맞춘 다음 시도에 맡긴다(#1016 36번 마무리 ①)
  AMBIGUOUS_REFUND_RESOLVED: {
    retryable: true,
    message: '이전 환불 요청의 결과를 확인했습니다. 환불 금액을 다시 계산해 주세요.',
  },
  // 무통장 환불을 다시 보내려면 고객 계좌가 필요한데 wallet 은 계좌를 저장하지 않는다 — 다시 보내도 같다
  AMBIGUOUS_REFUND_NEEDS_ACCOUNT: {
    retryable: false,
    message:
      '결제사 응답이 끊긴 이전 환불이 있습니다. 토스페이먼츠 상점관리자에서 환불 여부를 확인한 뒤 계좌 송금으로 처리해 주세요.',
  },
} as const satisfies Record<string, { retryable: boolean; message: string }>;

export type WalletRefundRefusalCode = keyof typeof REFUSALS;

/**
 * message 는 운영자가 읽는 한국어 문장이다 — Medusa 가 그대로 정산 실패 사유로 싣고 admin-web 이 보인다(#1016 36번).
 * 결제분 id 같은 개발용 문장은 detail 로 둔다(로그·진단용).
 */
export function refundRefusal(
  error: WalletRefundRefusalCode,
  detail: string,
): { error: WalletRefundRefusalCode; message: string; detail: string; retryable: boolean } {
  return { error, message: REFUSALS[error].message, detail, retryable: REFUSALS[error].retryable };
}
