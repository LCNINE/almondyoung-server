export function usesTossWidget(responsePayload: unknown): boolean {
  if (!responsePayload || typeof responsePayload !== 'object') return false;
  const nextAction = (responsePayload as Record<string, unknown>).nextAction;
  return (
    !!nextAction && typeof nextAction === 'object' && (nextAction as Record<string, unknown>).checkoutMode === 'WIDGET'
  );
}

/** 닫지 못한 위젯 가상계좌 표식. 정리(abandon·만료)가 계좌를 닫기 전엔 같은 intent 를 다시 결제시키지 않는다. */
export const VIRTUAL_ACCOUNT_LEFT_OPEN = 'virtualAccountLeftOpenAt';

export function hasVirtualAccountLeftOpen(responsePayload: unknown): boolean {
  return !!responsePayload && typeof responsePayload === 'object' && VIRTUAL_ACCOUNT_LEFT_OPEN in responsePayload;
}
