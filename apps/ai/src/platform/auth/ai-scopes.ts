import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

export const AI_SCOPE = {
  /** 어드민 업무 도구 전반 — 상품 등록·수정·삭제·발행, 엑셀 일괄, 상품설명 초안 */
  ASSISTANT: 'ai:assistant',
  /**
   * 쇼핑몰 고객이 쓰는 도구 — 자기 주문 조회·배송 추적 같은 것.
   */
  STOREFRONT: 'ai:storefront',
} as const;

export type AiScope = (typeof AI_SCOPE)[keyof typeof AI_SCOPE];

export const AI_SCOPES: ScopeDefinition[] = [
  {
    key: AI_SCOPE.ASSISTANT,
    category: 'ai',
    description: '어드민 AI 어시스턴트 및 상품 상세설명 초안 사용',
  },
  {
    key: AI_SCOPE.STOREFRONT,
    category: 'ai',
    description: '쇼핑몰 고객 AI 상담 (자기 주문 범위)',
  },
];

export const AI_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  { roleName: 'admin', scopeKeys: [AI_SCOPE.ASSISTANT] },
  { roleName: 'master', scopeKeys: [AI_SCOPE.ASSISTANT, AI_SCOPE.STOREFRONT] },
  // 고객 스킬이 실제로 생기기 전까지 이 스코프로는 부를 도구가 없다 —
  // 모델은 도구 없이 말만 한다. 스킬을 더하면 그때부터 동작한다.
  { roleName: 'user', scopeKeys: [AI_SCOPE.STOREFRONT] },
  { roleName: 'membership', scopeKeys: [AI_SCOPE.STOREFRONT] },
];
