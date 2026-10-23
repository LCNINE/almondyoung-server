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
