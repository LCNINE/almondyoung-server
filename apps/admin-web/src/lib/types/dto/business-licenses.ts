export type BusinessLicenseStatus = 'under_review' | 'approved' | 'rejected';

export interface BusinessLicenseDto {
  id: string;
  userId: string;
  userName?: string | null;
  shopId?: string | null;
  businessNumber?: string | null;
  representativeName?: string | null;
  status: BusinessLicenseStatus;
  reviewComment?: string | null;
  reviewedAt?: string | null;
  verifiedAt?: string | null;
  fileUrl?: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessLicenseListResponse {
  data: BusinessLicenseDto[];
  total: number;
  page: number;
  limit: number;
}

export interface BusinessLicenseListQuery {
  page?: number;
  limit?: number;
  status?: BusinessLicenseStatus | BusinessLicenseStatus[];
  hasVerificationFile?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface BusinessLicenseUpdateDto {
  userId: string;
  status: BusinessLicenseStatus;
  reviewComment?: string;
  fileUrl?: string | null;
}

/**
 * 관리자가 특정 사용자의 사업자 등록 정보를 등록/수정(upsert)할 때 보내는 페이로드.
 * 수동 입력 전용.
 */
export interface BusinessLicenseUpsertDto {
  businessNumber: string;
  representativeName: string;
  status?: BusinessLicenseStatus;
}

export const BUSINESS_LICENSE_STATUS_LABELS: Record<BusinessLicenseStatus, string> = {
  under_review: '심사중',
  approved: '승인',
  rejected: '반려',
};

export const BUSINESS_LICENSE_STATUS_LIST: BusinessLicenseStatus[] = [
  'under_review',
  'approved',
  'rejected',
];
