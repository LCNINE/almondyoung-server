/**
 * 관리자 계정 관련 쿼리 키
 * - 관리자 목록 조회, 상세 정보, 권한 관리 등에 사용
 * - 현재 로그인한 사용자가 아닌 시스템 내 다른 관리자들을 관리할 때 사용
 */
export const usersQueryKeys = {
  all: ['users'] as const,
  user: (id: string) => [...usersQueryKeys.all, id] as const,
  userRolesById: (userId: string) =>
    [...usersQueryKeys.all, userId, 'roles'] as const,
} as const;
