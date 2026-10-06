export function usesTossWidget(responsePayload: unknown): boolean {
  if (!responsePayload || typeof responsePayload !== 'object') return false;
  const nextAction = (responsePayload as Record<string, unknown>).nextAction;
  return (
    !!nextAction && typeof nextAction === 'object' && (nextAction as Record<string, unknown>).checkoutMode === 'WIDGET'
  );
}

export function usesCustomTossCheckout(responsePayload: unknown): boolean {
  if (!responsePayload || typeof responsePayload !== 'object') return false;
  const nextAction = (responsePayload as Record<string, unknown>).nextAction;
  return (
    !!nextAction && typeof nextAction === 'object' && (nextAction as Record<string, unknown>).checkoutMode === 'CUSTOM'
  );
}

export function usesCustomBrandPay(responsePayload: unknown): boolean {
  if (!usesCustomTossCheckout(responsePayload)) return false;
  const record = responsePayload as Record<string, unknown>;
  const staged = record.stagedApproval as { paymentType?: string } | undefined;
  return record.paymentType === 'BRANDPAY' || staged?.paymentType === 'BRANDPAY';
}
