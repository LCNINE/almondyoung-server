// src/lib/types/dto/customers
// 고객 관련 DTO 타입 정의

import type { BaseUserInfo, UUID } from './common';
import { Shop } from './shop';

// ===== 기본 고객 정보 =====
interface Customer extends BaseUserInfo {}

// ===== 고객 프로필 =====
interface CustomerProfileDetail {
  id: UUID;
  userId: UUID;
  phoneNumber: string | null;
  address: string | null;
  birthDate: string | null;
  profileImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerProfile extends BaseUserInfo {
  nickname: string | null;
  shop: Shop | null;
  profile: CustomerProfileDetail | null;
  roles: string[];
}

interface UpdateCustomerProfileDto {
  username?: string;
  phoneNumber?: string;
  birthDate?: string;
  profileImageUrl?: string;
}

// ===== 사용자 동의 =====
interface CustomerConsent {
  id: number;
  updatedAt: Date;
  userId: string;
  isOver14: boolean;
  termsOfService: boolean;
  electronicTransaction: boolean;
  privacyPolicy: boolean;
  thirdPartySharing: boolean;
  marketingConsent: boolean;
  consentedAt: Date;
}

interface CreateCustomerConsentDto extends CustomerConsent {}

// ===== 블랙리스트 =====
interface CustomerBlacklistItem {
  id: UUID;
  userId: UUID;
  reason: string;
  internalNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateCustomerBlacklistDto {
  userId: UUID;
  reason: string;
  internalNote?: string;
}

interface CustomerBlacklistQueryDto {
  userId?: UUID;
  limit?: number;
  page?: number;
}

// ===== 사업자 등록 =====
type CustomerBusinessLicenseStatus = 'under_review' | 'approved' | 'rejected';

interface CustomerBusinessLicense {
  id: UUID;
  verificationFile: string | null;
  shopId: string | null;
  businessNumber: string | null;
  representativeName: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  status: CustomerBusinessLicenseStatus;
  reviewComment: string | null;
  verifiedAt: Date | null;
}

interface CreateCustomerBusinessLicenseDto {
  businessNumber?: string;
  representativeName?: string;
  verificationFile?: string;
  metadata?: any;
}

interface UpdateCustomerBusinessLicenseDto extends Partial<CreateCustomerBusinessLicenseDto> {}

interface UpdateCustomerBusinessLicenseWithReviewDto extends UpdateCustomerBusinessLicenseDto {
  status?: CustomerBusinessLicenseStatus;
  reviewComment?: string;
}

interface CustomerBusinessLicenseQueryDto {
  page?: number;
  limit?: number;
  search?: {
    id?: string;
    businessNumber?: string;
    representativeName?: string;
  };
  sortBy: 'createdAt' | 'verifiedAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
  hasShopId?: boolean; // 샵이 있는지
  status?: CustomerBusinessLicenseStatus;
  daterange?: {
    start: string;
    end: string;
  };
  hasVerificationFile?: boolean; // 검증 파일이 있는지
}

// ===== 관리자 회원 수정/목록 (user-service admin API) =====

// 관리자가 회원 기본정보 수정 시 보내는 필드 (user-service UpdateUserDto 의 스칼라 부분만)
interface AdminUpdateUserDto {
  username?: string;
  nickname?: string;
  phoneNumber?: string; // E.164 (+8210...)
  birthDate?: string;
}

// 관리자 사업자등록증 수정 (user-service BusinessAdminUpdateDto). userId 필수, 나머지 선택.
interface AdminUpdateBusinessLicenseDto {
  userId: string;
  businessNumber?: string;
  representativeName?: string;
  status?: CustomerBusinessLicenseStatus;
  reviewComment?: string;
  fileUrl?: string | null;
}

interface CustomerListQuery {
  page?: number;
  limit?: number;
  q?: string;
  roleName?: string;
  sort?: 'createdAt' | 'username' | 'email' | 'lastActivityAt' | 'phoneNumber';
  order?: 'asc' | 'desc';
}

interface CustomerListItem {
  id: string;
  loginId: string;
  username: string;
  nickname: string | null;
  email: string;
  phoneNumber: string | null;
  isEmailVerified: boolean;
  lastActivityAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  roles: string[];
}

interface CustomerListResponse {
  data: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
}

export type {
  AdminUpdateUserDto,
  AdminUpdateBusinessLicenseDto,
  CustomerListQuery,
  CustomerListItem,
  CustomerListResponse,
  Customer,
  CustomerProfile,
  CustomerProfileDetail,
  UpdateCustomerProfileDto,
  CustomerConsent,
  CreateCustomerConsentDto,
  CustomerBlacklistItem,
  CreateCustomerBlacklistDto,
  CustomerBlacklistQueryDto,
  CustomerBusinessLicenseStatus,
  CustomerBusinessLicense,
  CreateCustomerBusinessLicenseDto,
  UpdateCustomerBusinessLicenseDto,
  UpdateCustomerBusinessLicenseWithReviewDto,
  CustomerBusinessLicenseQueryDto,
};
