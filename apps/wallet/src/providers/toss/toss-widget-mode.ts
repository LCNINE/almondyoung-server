export function usesTossWidget(responsePayload: unknown): boolean {
  if (!responsePayload || typeof responsePayload !== 'object') return false;
  const nextAction = (responsePayload as Record<string, unknown>).nextAction;
  return (
    !!nextAction && typeof nextAction === 'object' && (nextAction as Record<string, unknown>).checkoutMode === 'WIDGET'
  );
}
