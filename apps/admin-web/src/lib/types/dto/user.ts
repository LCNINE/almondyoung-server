// src/lib/types/dto/users.ts
// 사용자 관련 DTO 타입 정의

import type { BaseUserInfo, UUID } from './common';

// ===== 기본 관리자 사용자 정보 =====
interface User extends BaseUserInfo {}

// ===== 관리자 관련 =====
interface CreateAdminAccountDto {
  name: string;
  nickname: string;
  loginId: string;
  email: string;
  password: string;
  roleId: string;
  phone_number: string;
}

interface UserRolesResponseDto {
  userId: UUID;
  roles: {
    role: { id: string; name: string };

    scopes: {
      scope_name: string;
      description: string;
    };
  }[];
}

// ===== 어드민 사용자 목록 조회 =====
interface AdminUsersQuery {
  page?: number;
  limit?: number;
  userId?: string;
  username?: string;
  email?: string;
  roleName?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

interface AdminUserDto {
  id: string;
  loginId: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  lastActivityAt: string | null;
  createdAt: string;
  deletedAt: string | null;
}

interface AdminUsersResponse {
  data: AdminUserDto[];
  total: number;
  page: number;
  limit: number;
}

export type {
  CreateAdminAccountDto,
  User,
  UserRolesResponseDto,
  AdminUsersQuery,
  AdminUserDto,
  AdminUsersResponse,
};
