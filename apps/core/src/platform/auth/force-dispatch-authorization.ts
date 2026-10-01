import {
  getScopeAuthorizationDecision,
  isScopeAuthorizationDecision,
  ScopeAuthorizationDecision,
} from '@app/authorization';
import { FULFILLMENT_SCOPE } from './fulfillment-scopes';

/**
 * 강제출고를 허락하는 판정 — 관리자(`dispatch.force`) 또는 스테이션 작업자(`dispatch.station_force`, 스펙 U15).
 * 판정 객체는 ScopeGuard 가 그 요청이 요구한 스코프에 대해서만 만든다. 그래서 station 판정은 그 스코프를 요구하는
 * 라우트(단순출고 강제완료)로 들어온 요청에만 존재하고, 관리자 전용 강제 발송 라우트로는 만들어지지 않는다.
 */
export function isForceDispatchDecision(value: unknown): value is ScopeAuthorizationDecision {
  return (
    isScopeAuthorizationDecision(value, FULFILLMENT_SCOPE.DISPATCH_FORCE) ||
    isScopeAuthorizationDecision(value, FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE)
  );
}

/** 요청에 기록된 강제출고 판정. 관리자 판정을 우선한다(둘 다 있으면 감사 로그에 관리자로 남는다). */
export function forceDispatchDecisionFrom(request: unknown): ScopeAuthorizationDecision | undefined {
  return (
    getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_FORCE) ??
    getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE)
  );
}
