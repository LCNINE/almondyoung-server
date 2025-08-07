import { z } from 'zod';

export const USER_SCOPES = {
  USER: {
    READ: 'user:read',
    UPDATE: 'users:update',
    DELETE: 'users:delete',
    WRITE: 'users:write',
  },
  MASTER: 'master',
} as const;

export const UserScopeSchema = z.enum([
  USER_SCOPES.USER.READ,
  USER_SCOPES.USER.UPDATE,
  USER_SCOPES.USER.DELETE,
  USER_SCOPES.USER.WRITE,
  USER_SCOPES.MASTER,
]);

export type UserScope = z.infer<typeof UserScopeSchema>;

export const SCOPE_DESCRIPTIONS: Record<UserScope, string> = {
  [USER_SCOPES.USER.READ]: '일반 사용자 조회 권한',
  [USER_SCOPES.USER.UPDATE]: '일반 사용자 수정 권한',
  [USER_SCOPES.USER.DELETE]: '일반 사용자 삭제 권한',
  [USER_SCOPES.USER.WRITE]: '일반 사용자 작성 권한',
  [USER_SCOPES.MASTER]: '모든 권한',
} as const;
