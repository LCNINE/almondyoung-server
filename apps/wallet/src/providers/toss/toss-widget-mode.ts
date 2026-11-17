/**
 * 토스 시크릿 키 세 벌. LEGACY 는 구 상점의 API 개별 연동 키, WIDGET 은 새 상점의 결제위젯 키,
 * DIRECT 는 새 상점의 API 개별 연동 키다. 가상계좌 직접 발급은 위젯 키로 부르면 NOT_FOUND_MERCHANT 라 DIRECT 로 한다.
 */
export type TossKey = 'LEGACY' | 'WIDGET' | 'DIRECT';

export const TOSS_SECRET_ENV = {
  LEGACY: 'TOSS_SECRET_KEY',
  WIDGET: 'TOSS_WIDGET_SECRET_KEY',
  DIRECT: 'TOSS_DIRECT_SECRET_KEY',
} as const satisfies Record<TossKey, string>;

/** charge 를 만든 키. 조회·취소·환불은 발급 때와 같은 키로 해야 한다(nextAction.checkoutMode 에 남긴다). */
export function tossKeyOf(responsePayload: unknown): TossKey {
  if (!responsePayload || typeof responsePayload !== 'object') return 'LEGACY';
  const nextAction = (responsePayload as Record<string, unknown>).nextAction;
  if (!nextAction || typeof nextAction !== 'object') return 'LEGACY';

  const mode = (nextAction as Record<string, unknown>).checkoutMode;
  if (mode === 'WIDGET') return 'WIDGET';
  if (mode === 'DIRECT') return 'DIRECT';

  return 'LEGACY';
}

/** 닫지 못한 위젯 가상계좌 표식. 진행 중 charge 는 abandon 이, 끝난 charge 는 OpenVirtualAccountCloseJob 이 닫는다. */
export const VIRTUAL_ACCOUNT_LEFT_OPEN = 'virtualAccountLeftOpenAt';

export function hasVirtualAccountLeftOpen(responsePayload: unknown): boolean {
  return !!responsePayload && typeof responsePayload === 'object' && VIRTUAL_ACCOUNT_LEFT_OPEN in responsePayload;
}

/**
 * 토스 승인 호출 직전에 남기는 표식. 응답을 잃으면 결제·계좌가 토스에 살아 있을 수 있어, 이 표식이 남은
 * 진행 중 charge 는 DB 만 취소하지 않고 TossPaymentProvider.cancel 이 토스 상태를 물어 정리한다.
 */
export const CONFIRM_ATTEMPT = 'confirmAttempt';

export function hasConfirmAttempt(responsePayload: unknown): boolean {
  return !!responsePayload && typeof responsePayload === 'object' && CONFIRM_ATTEMPT in responsePayload;
}

/** 이 charge 의 토스 paymentKey — 확정된 키, 계좌 발급 때 남긴 키, 승인 직전 표식 순으로 찾는다. */
export function knownTossPaymentKey(
  responsePayload: unknown,
  providerTransactionId?: string | null,
): string | undefined {
  if (providerTransactionId) return providerTransactionId;
  if (!responsePayload || typeof responsePayload !== 'object') return undefined;

  const payload = responsePayload as Record<string, unknown>;
  if (typeof payload.paymentKey === 'string') return payload.paymentKey;

  const attempt = payload[CONFIRM_ATTEMPT];
  if (attempt && typeof attempt === 'object') {
    const key = (attempt as Record<string, unknown>).paymentKey;
    if (typeof key === 'string') return key;
  }

  return undefined;
}
