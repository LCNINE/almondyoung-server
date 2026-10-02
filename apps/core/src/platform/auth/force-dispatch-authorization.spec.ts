import { SCOPE_AUTHORIZATION_DECISION_BRAND } from '@app/authorization';
import { FULFILLMENT_SCOPE } from './fulfillment-scopes';
import { isForceDispatchDecision } from './force-dispatch-authorization';

const decision = (scope: string, granted = true) => ({ scope, granted, [SCOPE_AUTHORIZATION_DECISION_BRAND]: true });

describe('isForceDispatchDecision', () => {
  it.each([
    ['관리자 강제출고', decision(FULFILLMENT_SCOPE.DISPATCH_FORCE), true],
    ['스테이션 강제출고', decision(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE), true],
    ['다른 스코프', decision(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE), false],
    ['거절된 판정', decision(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE, false), false],
    ['브랜드 없는 위조 객체', { scope: FULFILLMENT_SCOPE.DISPATCH_FORCE, granted: true }, false],
    ['판정 없음', undefined, false],
  ])('%s → %s', (_name, value, expected) => {
    expect(isForceDispatchDecision(value)).toBe(expected);
  });
});
