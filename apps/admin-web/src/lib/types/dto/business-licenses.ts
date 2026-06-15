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
