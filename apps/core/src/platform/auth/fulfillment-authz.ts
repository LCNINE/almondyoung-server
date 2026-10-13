import { AuthorizationService } from '@app/authorization';
import { FulfillmentScope, SHORT_PICK_REPORT_SCOPES } from './fulfillment-scopes';

/*
 * 출고 판정의 «옛 식». 판정 지점은 이 값을 그대로 결과로 쓰고, 권한 판정은 옆에서 비교만 한다
 * (`PermissionCheckpoints`). 역할 이름을 아는 곳을 여기 하나로 모았다 — 판정 주체가 넘어가면 통째로 지운다.
 */

export function legacyFulfillmentSupervisor(roles: readonly string[]): boolean {
  return roles.some((role) => role === 'logistics_manager' || role === 'master');
}

export async function legacyHasFulfillmentScope(
  authorization: Pick<AuthorizationService, 'getScopesByRoles'>,
  roles: readonly string[],
  scope: FulfillmentScope,
): Promise<boolean> {
  if (roles.includes('master')) return true;
  const scopes = await authorization.getScopesByRoles([...roles]);
  return scopes.has(scope);
}

export async function legacyHasShortPickScope(
  authorization: Pick<AuthorizationService, 'getScopesByRoles'>,
  roles: readonly string[],
): Promise<boolean> {
  if (roles.includes('master')) return true;
  const scopes = await authorization.getScopesByRoles([...roles]);
  if (scopes.has('master')) return true;
  return SHORT_PICK_REPORT_SCOPES.some((scope) => scopes.has(scope));
}
