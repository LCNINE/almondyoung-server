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
  q?: string;
  username?: string;
  email?: string;
  roleName?: string;
  sort?: string;
  order?: string;
  ids?: string;
}

interface AdminUserDto {
  id: string;
  loginId: string;
  username: string;
  nickname: string | null;
  email: string;
  isEmailVerified: boolean;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  roles: string[];
}

interface AdminUserProfileDto {
  id: string;
  userId: string;
  phoneNumber: string | null;
  address: unknown | null;
  birthDate: string | null;
  profileImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminUserShopDto {
  id: string;
  userId: string;
  isOperating: boolean | null;
  yearsOperating: number | null;
  shopType: 'solo' | 'small' | 'large' | null;
  categories: unknown;
  targetCustomers: unknown;
  openDays: unknown;
  createdAt: string;
  updatedAt: string;
}

interface AdminUserDetailDto extends AdminUserDto {
  shop: AdminUserShopDto | null;
  profile: AdminUserProfileDto | null;
}

interface AdminUsersResponse {
  data: AdminUserDto[];
  total: number;
  page: number;
  limit: number;
}

// ===== Role 관련 =====
interface RoleDto {
  roleId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateRoleDto {
  name: string;
  description?: string;
}

interface UpdateRoleDto {
  name?: string;
  description?: string;
}

interface AdminUserRolesResponseDto {
  roles: RoleDto[];
}

interface ReplaceUserRolesDto {
  roleIds: string[];
}

interface UpdateMyProfileDto {
  username?: string;
  nickname?: string;
}

export type {
  CreateAdminAccountDto,
  User,
  UserRolesResponseDto,
  AdminUsersQuery,
  AdminUserDto,
  AdminUserDetailDto,
  AdminUsersResponse,
  RoleDto,
  CreateRoleDto,
  UpdateRoleDto,
  AdminUserRolesResponseDto,
  ReplaceUserRolesDto,
  UpdateMyProfileDto,
};
