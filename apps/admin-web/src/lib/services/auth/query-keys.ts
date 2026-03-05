/**
 * 인증 관련 쿼리 키
 * - 로그인, 로그아웃, 토큰 갱신이나
 * - 현재 접속중인 유저(관리자) 정보 조회에 사용합니다.
 */
export const authQueryKeys = {
  all: ['auth'] as const,
  me: () => [...authQueryKeys.all, 'me'] as const,
  myRoles: () => [...authQueryKeys.all, 'me', 'roles'] as const,
} as const;
