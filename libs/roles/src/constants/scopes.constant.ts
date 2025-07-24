import { z } from 'zod';

export const USER_SCOPES = {
  USER: {
    READ: 'user:read',
    UPDATE: 'users:update',
  },
  MASTER: 'master',
} as const;

export const UserScopeSchema = z.enum([
  USER_SCOPES.USER.READ,
  USER_SCOPES.USER.UPDATE,
  USER_SCOPES.MASTER,
]);

export type UserScope = z.infer<typeof UserScopeSchema>;

export const SCOPE_DESCRIPTIONS: Record<UserScope, string> = {
  [USER_SCOPES.USER.READ]: '사용자 정보 조회 권한',
  [USER_SCOPES.USER.UPDATE]: '사용자 정보 수정 권한',
  [USER_SCOPES.MASTER]: '모든 권한',
} as const;
