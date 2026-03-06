// src/lib/types/dto/common.ts
// 공통 타입 정의

type UUID = string;

// ===== 페이지네이션 관련 =====
interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface SearchQuery {
  search?: string;
  page?: number;
  limit?: number;
}

interface BaseUserInfo {
  id: UUID;
  loginId: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type { PaginationQuery, SearchQuery, BaseUserInfo, UUID };
