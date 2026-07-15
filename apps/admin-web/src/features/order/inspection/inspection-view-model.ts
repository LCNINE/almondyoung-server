export const FORCE_DISPATCH_SCOPE = 'fulfillment.dispatch.force';

export function canShowForceDispatch(
  grantedScopes: readonly string[]
): boolean {
  return grantedScopes.includes(FORCE_DISPATCH_SCOPE);
}

export function inspectionServerDenyMessage(input: {
  status?: number | null;
  message?: string;
}): string | null {
  if (input.status === 403)
    return `권한이 없어 서버가 강제 출고를 거부했습니다.${input.message ? ` ${input.message}` : ''}`;
  if (input.status === 409)
    return `현재 shipment 버전 또는 상태와 충돌합니다.${input.message ? ` ${input.message}` : ''}`;
  return null;
}
