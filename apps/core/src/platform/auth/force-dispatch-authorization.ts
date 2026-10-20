import {
  getPermissionDecision,
  getScopeAuthorizationDecision,
  isPermissionDecision,
  isScopeAuthorizationDecision,
  PermissionDecision,
  ScopeAuthorizationDecision,
} from '@app/authorization';
import { FULFILLMENT_SCOPE, SIMPLE_OUTBOUND_FORCE_SCOPES } from './fulfillment-scopes';

/**
 * 강제출고를 허락하는 판정 — 관리자(`dispatch.force`) 또는 스테이션 작업자(`dispatch.station_force`, 스펙 U15).
 * 판정 객체는 라우트 가드가 그 요청이 요구한 권한에 대해서만 만든다. 그래서 station 판정은 그 권한을 요구하는
 * 라우트(단순출고 강제완료)로 들어온 요청에만 존재하고, 관리자 전용 강제 발송 라우트로는 만들어지지 않는다.
 *
 * 판정을 누가 냈는지는 서비스의 판정 모드가 정한다: 그림자 모드는 옛 `ScopeGuard` 낙인, 새 권한 판정으로 넘어간
 * 서비스는 `PermissionGuard` 낙인. 한 모드는 그 모드의 낙인만 받는다(ADR-0047 §39). 낙인 키는 두 체계가 같은 문자열이다.
 */
export type ForceDispatchDecision = ScopeAuthorizationDecision | PermissionDecision;

const ADMIN_FORCE = [FULFILLMENT_SCOPE.DISPATCH_FORCE] as const;

function decisionFrom(request: unknown, keys: readonly string[], enforced: boolean): ForceDispatchDecision | undefined {
  for (const key of keys) {
    const decision = enforced ? getPermissionDecision(request, key) : getScopeAuthorizationDecision(request, key);
    if (decision) return decision;
  }
  return undefined;
}

function isDecisionAmong(value: unknown, keys: readonly string[]): value is ForceDispatchDecision {
  return keys.some((key) => isScopeAuthorizationDecision(value, key) || isPermissionDecision(value, key));
}

/** 요청에 기록된 강제출고 판정. 관리자 판정을 우선한다(둘 다 있으면 감사 로그에 관리자로 남는다). */
export function forceDispatchDecisionFrom(request: unknown, enforced: boolean): ForceDispatchDecision | undefined {
  return decisionFrom(request, SIMPLE_OUTBOUND_FORCE_SCOPES, enforced);
}

/** 관리자 전용 강제 발송 라우트의 판정 — 스테이션 판정은 여기서 쓰이지 않는다. */
export function adminForceDispatchDecisionFrom(request: unknown, enforced: boolean): ForceDispatchDecision | undefined {
  return decisionFrom(request, ADMIN_FORCE, enforced);
}

export function isForceDispatchDecision(value: unknown): value is ForceDispatchDecision {
  return isDecisionAmong(value, SIMPLE_OUTBOUND_FORCE_SCOPES);
}

export function isAdminForceDispatchDecision(value: unknown): value is ForceDispatchDecision {
  return isDecisionAmong(value, ADMIN_FORCE);
}

/** 감사 기록에 남기는 판정 키. */
export function forceDispatchDecisionKey(decision: ForceDispatchDecision): string {
  return 'scope' in decision ? decision.scope : decision.permission;
}

/** 감사 기록에 남기는 판정 출처. */
export function forceDispatchDecisionSource(decision: ForceDispatchDecision): 'scope_guard' | 'permission_guard' {
  return 'scope' in decision ? 'scope_guard' : 'permission_guard';
}
