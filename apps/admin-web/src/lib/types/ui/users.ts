// src/lib/types/ui/users.ts
// Users 도메인 UI 타입 정의

import type { User } from '../dto/user';

// UI에서 사용하는 사용자 타입
export interface UserUI extends User {
  // UI 전용 필드들
  isSelected?: boolean;
  statusColor?: string;
  statusIcon?: string;
  formattedCreatedAt?: string;
  formattedLastLogin?: string;
  roleNames?: string[];
  permissionCount?: number;
  isActive?: boolean;
}

// UI에서 사용하는 사용자 상세 타입
export interface UserDetailUI extends User {
  // UI 전용 필드들
  isSelected?: boolean;
  formattedCreatedAt?: string;
  formattedLastLogin?: string;
  formattedUpdatedAt?: string;
  roleNames?: string[];
  permissionCount?: number;
  isActive?: boolean;
  profileImage?: string;
  initials?: string;
}

// 사용자 목록 필터 타입
export interface UserListFilter {
  role?: string[];
  status?: 'active' | 'inactive' | 'pending';
  search?: string;
  sortBy?: 'name' | 'email' | 'createdAt' | 'lastLogin';
  sortOrder?: 'asc' | 'desc';
}

// 사용자 목록 페이지네이션 타입
export interface UserListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// 사용자 목록 응답 타입
export interface UserListResponse {
  data: UserUI[];
  pagination: UserListPagination;
  filters: UserListFilter;
}

// 사용자 생성/수정 폼 타입
export interface UserFormData {
  name: string;
  email: string;
  phone?: string;
  roleIds: string[];
  isActive: boolean;
  password?: string;
  confirmPassword?: string;
  profileImage?: File;
}

// 사용자 프로필 수정 폼 타입
export interface UserProfileFormData {
  name: string;
  phone?: string;
  profileImage?: File;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

// 사용자 권한 타입
export interface UserPermission {
  id: string;
  name: string;
  description?: string;
  resource: string;
  action: string;
  isGranted: boolean;
}

// 사용자 역할 타입
export interface UserRoleUI {
  id: string;
  name: string;
  description?: string;
  permissions: UserPermission[];
  userCount?: number;
  isSystem?: boolean;
}

// 사용자 대시보드 타입
export interface UserDashboard {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  pendingUsers: number;
  recentUsers: UserUI[];
  topRoles: TopRoleUI[];
  userActivity: UserActivityUI[];
}

// 상위 역할 UI 타입
export interface TopRoleUI {
  roleId: string;
  roleName: string;
  userCount: number;
  percentage: number;
  formattedPercentage?: string;
}

// 사용자 활동 UI 타입
export interface UserActivityUI {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  timestamp: string;
  formattedTimestamp?: string;
  ipAddress?: string;
  userAgent?: string;
}

// 사용자 세션 타입
export interface UserSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  formattedExpiresAt?: string;
  ipAddress?: string;
  userAgent?: string;
  isActive: boolean;
  createdAt: string;
  formattedCreatedAt?: string;
}

// 사용자 알림 타입
export interface UserNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  createdAt: string;
  formattedCreatedAt?: string;
  actionUrl?: string;
  actionText?: string;
}

// 사용자 설정 타입
export interface UserSettings {
  id: string;
  userId: string;
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  preferences: {
    itemsPerPage: number;
    defaultSort: string;
    autoRefresh: boolean;
    refreshInterval: number;
  };
}
