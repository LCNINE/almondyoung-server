import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

/**
 * 멤버십 운영 스코프.
 *
 * 이전에는 모든 관리자 액션이 `RolesGuard('admin','master')` 하나로만 막혀 있어, 어떤 admin 이든
 * 금액 제한 없이 환불할 수 있었다. 다만 위험의 실체는 "환불 자체"가 아니라 **정책 산정액보다 많이
 * 환불하는 것**이다(해지·환불은 CS 의 일상 업무다). 그래서 일상 권한은 admin 에게 그대로 두고,
 * 정책 초과 환불만 별도 스코프로 분리한다.
 */
export const MEMBERSHIP_SCOPE = {
  /** 해지(예약/즉시) 및 정책 산정액 이내 환불 */
  BILLING_REFUND: 'membership.billing.refund',
  /** 정책 산정액을 초과하는 환불 (장애 보상 등 예외) */
  BILLING_REFUND_OVERRIDE: 'membership.billing.refund_override',
} as const;

export type MembershipScope = (typeof MEMBERSHIP_SCOPE)[keyof typeof MEMBERSHIP_SCOPE];

export const MEMBERSHIP_SCOPES: ScopeDefinition[] = [
  {
    key: MEMBERSHIP_SCOPE.BILLING_REFUND,
    category: 'membership',
    description: '구독 강제 해지 및 정책 산정액 이내 환불',
  },
  {
    key: MEMBERSHIP_SCOPE.BILLING_REFUND_OVERRIDE,
    category: 'membership',
    description: '정책 산정액을 초과하는 환불 (예외 보상)',
  },
];

/**
 * 역할별 부여.
 *
 * `master` 는 ScopeGuard 에서 항상 통과하므로 매핑에 넣지 않아도 모든 스코프를 가진다.
 * 여기 없는 역할 이름은 스코프를 전혀 얻지 못한다(AuthorizationService 가 미등록 역할을 거른다) —
 * 새 운영 역할을 만들면 이 목록에 반드시 추가해야 한다.
 */
export const MEMBERSHIP_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  {
    roleName: 'admin',
    scopeKeys: [MEMBERSHIP_SCOPE.BILLING_REFUND],
  },
  {
    roleName: 'master',
    scopeKeys: [MEMBERSHIP_SCOPE.BILLING_REFUND, MEMBERSHIP_SCOPE.BILLING_REFUND_OVERRIDE],
  },
];
