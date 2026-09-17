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
  // 고객 역할에는 아직 스코프를 주지 않는다. 도구가 없어도 모델은 돌고
  // 사용자당 한도가 없어서, 토큰만 있으면 OpenAI 요금을 무한히 태울 수 있다.
  // 고객 스킬을 만들 때 한도와 함께 STOREFRONT 를 넣는다.
  //
  // 역할을 지우지 말고 빈 배열로 둘 것. ensureRoleScopeMappings 는 목록에 있는
  // 역할만 조정하므로, 지우면 이미 부여된 DB 행이 남아 권한이 살아 있어 보인다.
  { roleName: 'user', scopeKeys: [] },
  { roleName: 'membership', scopeKeys: [] },
];
