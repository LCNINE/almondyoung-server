// src/lib/types/dto/users.ts
// 사용자 관련 DTO 타입 정의

import type { BaseUserInfo, UUID } from './common';
import type { Permission } from '@permission-catalog';
import type { Assignment, StaffRoleBadge } from './iam';

// ===== 기본 관리자 사용자 정보 =====
interface User extends BaseUserInfo {}

// ===== 관리자 관련 =====
// 초기 비밀번호는 서버가 랜덤 생성한다 (POST /admin/auth 응답의 initialPassword) — password 입력란 없음.
interface CreateAdminAccountDto {
  username: string;
  nickname: string;
  loginId: string;
  email: string;
  roleId: string;
  phone_number?: string;
}

interface CreateAdminAccountResult {
  user: {
    id: string;
    loginId: string;
    email: string;
    username: string;
  };
  initialPassword: string;
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
  /** staff: 직원 역할을 지금 가진 사람만(기간 부여 포함) */
  audience?: 'staff';
  /** audience=staff 와 함께만 — 이 권한을 가진 직원이 각 행의 holdsPermission 으로 표시된다 */
  holding?: Permission;
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
  // 목록(/admin/users)에만 실린다. 상세는 profile.phoneNumber
  phoneNumber?: string | null;
  isEmailVerified: boolean;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  roles: string[];
  /** audience=staff 일 때만 — 지금 유효한 직원 역할 */
  staffRoles?: StaffRoleBadge[];
  /** holding 을 줬을 때만 */
  holdsPermission?: boolean;
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

interface AdminUserRolesResponseDto {
  roles: Assignment[];
}

interface UpdateMyProfileDto {
  username?: string;
  nickname?: string;
}

export type {
  CreateAdminAccountDto,
  CreateAdminAccountResult,
  User,
  AdminUsersQuery,
  AdminUserDto,
  AdminUserDetailDto,
  AdminUsersResponse,
  RoleDto,
  AdminUserRolesResponseDto,
  UpdateMyProfileDto,
};
