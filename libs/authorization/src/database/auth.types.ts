/**
 * 역할 이름을 가진 최소 사용자 타입
 * JWT payload나 request.user에서 roles를 가진 모든 객체와 호환됨
 */
export interface UserWithRoles {
  roles: string[];
}

/**
 * JWT 토큰에서 추출된 사용자 정보.
 * user-service의 JwtAccessStrategy.validate()가 반환하는 형태와 일치.
 */
export interface JwtPayload {
  id: string;
  email: string;
  roles: string[];
  login_id?: string;
}
