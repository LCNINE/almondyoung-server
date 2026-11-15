export function usesTossWidget(responsePayload: unknown): boolean {
  if (!responsePayload || typeof responsePayload !== 'object') return false;
  const nextAction = (responsePayload as Record<string, unknown>).nextAction;
  return (
    !!nextAction && typeof nextAction === 'object' && (nextAction as Record<string, unknown>).checkoutMode === 'WIDGET'
  );
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
