import { getPermissionDecision, isPermissionDecision, PermissionDecision } from '@app/authorization';
import { FULFILLMENT_PERMISSION, SIMPLE_OUTBOUND_FORCE_PERMISSIONS } from './fulfillment-permissions';

/**
 * 강제출고를 허락하는 판정 — 관리자(`dispatch.force`) 또는 스테이션 작업자(`dispatch.station_force`, 스펙 U15).
 * 판정 객체는 `PermissionGuard` 가 그 요청이 요구한 권한에 대해서만 남긴다. 그래서 station 판정은 그 권한을 요구하는
 * 라우트(단순출고 강제완료)로 들어온 요청에만 존재하고, 관리자 전용 강제 발송 라우트로는 만들어지지 않는다.
 */
const ADMIN_FORCE = [FULFILLMENT_PERMISSION.DISPATCH_FORCE];

/** 감사 기록에 남기는 판정 출처. */
export const FORCE_DISPATCH_AUTHORIZATION_SOURCE = 'permission_guard';

function decisionFrom(request: unknown, keys: readonly string[]): PermissionDecision | undefined {
  for (const key of keys) {
    const decision = getPermissionDecision(request, key);
    if (decision) return decision;
  }
  return undefined;
}

function isDecisionAmong(value: unknown, keys: readonly string[]): value is PermissionDecision {
  return keys.some((key) => isPermissionDecision(value, key));
}

/** 요청에 기록된 강제출고 판정. 관리자 판정을 우선한다(둘 다 있으면 감사 로그에 관리자로 남는다). */
export function forceDispatchDecisionFrom(request: unknown): PermissionDecision | undefined {
  return decisionFrom(request, SIMPLE_OUTBOUND_FORCE_PERMISSIONS);
}

/** 관리자 전용 강제 발송 라우트의 판정 — 스테이션 판정은 여기서 쓰이지 않는다. */
export function adminForceDispatchDecisionFrom(request: unknown): PermissionDecision | undefined {
  return decisionFrom(request, ADMIN_FORCE);
}

export function isForceDispatchDecision(value: unknown): value is PermissionDecision {
  return isDecisionAmong(value, SIMPLE_OUTBOUND_FORCE_PERMISSIONS);
}

export function isAdminForceDispatchDecision(value: unknown): value is PermissionDecision {
  return isDecisionAmong(value, ADMIN_FORCE);
}

/** 감사 기록에 남기는 판정 키. */
export function forceDispatchDecisionKey(decision: PermissionDecision): string {
  return decision.permission;
}
