import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { roles, scopes, roleScopeMapping } from './auth.schema';

export type Role = InferSelectModel<typeof roles>;
export type NewRole = InferInsertModel<typeof roles>;

export type Scope = InferSelectModel<typeof scopes>;
export type NewScope = InferInsertModel<typeof scopes>;

export type RoleScopeMapping = InferSelectModel<typeof roleScopeMapping>;
export type NewRoleScopeMapping = InferInsertModel<typeof roleScopeMapping>;

export interface ScopeDefinition {
  key: string;
  category: string;
  description: string;
}

/**
 * 런타임 스코프 체크를 위한 최소 사용자 타입
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

