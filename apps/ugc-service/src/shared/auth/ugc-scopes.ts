import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

/** ugc 관리자 스코프. 컨트롤러의 `@RequireScopes(...)` 문자열과 같아야 한다. */
export const UGC_SCOPE = {
  READ: 'admin:ugc:read',
  MODIFY: 'admin:ugc:modify',
} as const;

export const UGC_SCOPES: ScopeDefinition[] = [
  { key: UGC_SCOPE.READ, category: 'admin', description: '관리자 - UGC 조회 (리뷰, Q&A, 샵 매매 목록 조회)' },
  { key: UGC_SCOPE.MODIFY, category: 'admin', description: '관리자 - UGC 관리 (리뷰 댓글, Q&A 답변, 샵 매매 작성·검토)' },
];

/**
 * 역할별 부여. 부팅 시 `auth.role_scope_mapping` 을 이 선언에 맞춰 정합화한다.
 *
 * 2026-09-24 라이브 실측으로 ugc 에는 매핑이 한 행도 없어, `master`(ScopeGuard 가 항상 통과)만
 * 리뷰·Q&A·샵 매매를 관리할 수 있었다. 샵 매매가 core 에서 옮겨 오면 core 에서 관리하던 `admin`
 * 역할이 관리 화면을 잃으므로 `admin` 에 두 스코프를 준다 — 리뷰·Q&A 관리도 함께 열린다(의도).
 *
 * 여기 없는 역할은 스코프를 전혀 얻지 못한다(AuthorizationService 가 미등록 역할을 거른다).
 */
export const UGC_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  { roleName: 'admin', scopeKeys: [UGC_SCOPE.READ, UGC_SCOPE.MODIFY] },
];
