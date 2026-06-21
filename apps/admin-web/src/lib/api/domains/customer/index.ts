'use client';

// Customer 도메인 API 클라이언트

import { USER_SERVICE_BASE_URL } from '@/const';
import { Shop, User } from '@/lib/types';
import {
  BusinessLicenseDto,
  BusinessLicenseUpsertDto,
} from '@/lib/types/dto/business-licenses';
import {
  CustomerBusinessLicense,
  CustomerBusinessLicenseQueryDto,
  CustomerConsent,
  CustomerProfile,
} from '@/lib/types/dto/customers';
import { client } from '../../client';

export interface CustomerListQuery {
  page?: number;
  limit?: number;
  q?: string;
  roleName?: string;
  sort?: 'createdAt' | 'username' | 'email' | 'lastActivityAt' | 'phoneNumber';
  order?: 'asc' | 'desc';
}

export interface CustomerListItem {
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

export interface CustomerListResponse {
  data: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
}

export const customerApi = {
  // 사용자들 조회
  getCustomers: async (): Promise<User[]> => {
    const response = await client.get<User[]>(
      `${USER_SERVICE_BASE_URL}/admin/users`
    );
    return response.data;
  },

  // 고객 목록 조회 (페이지네이션 지원)
  getCustomersWithPagination: async (
    query: CustomerListQuery
  ): Promise<CustomerListResponse> => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
    const qs = params.toString();
    const response = await client.get<CustomerListResponse>(
      `${USER_SERVICE_BASE_URL}/admin/users${qs ? `?${qs}` : ''}`
    );
    return response.data;
  },

  // 사용자id로 사용자 정보 조회
  getCustomerById: async (id: string): Promise<CustomerProfile> => {
    const response = await client.get<CustomerProfile>(
      `${USER_SERVICE_BASE_URL}/admin/users/${id}`
    );
    return response.data;
  },

  // 이메일로 사용자 찾기
  findCustomerByEmail: async (email: string): Promise<User> => {
    const response = await client.get<User>(
      `${USER_SERVICE_BASE_URL}/users/find-by-email?email=${encodeURIComponent(
        email
      )}`
    );
    return response.data;
  },

  // 고객 동의 항목들 조회
  getCustomerConsents: async (query: {
    page?: number;
    limit?: number;
    sortBy?: 'createdAt' | 'username' | 'email' | 'lastActivityAt';
    sortOrder?: 'asc' | 'desc';
  }): Promise<CustomerConsent[]> => {
    const response = await client.get<CustomerConsent[]>(
      `${USER_SERVICE_BASE_URL}/admin/users/consents`,
      { params: query }
    );
    return response.data;
  },

  // 사업자 등록증 목록 조회
  getBusinessLicenses: async (
    query: CustomerBusinessLicenseQueryDto
  ): Promise<CustomerBusinessLicense[]> => {
    const response = await client.get<CustomerBusinessLicense[]>(
      `${USER_SERVICE_BASE_URL}/admin/users/business-licenses`,
      { params: query }
    );
    return response.data;
  },

  // 쇼핑몰 정보 조회
  getShopByUserId: async (userId: string): Promise<Shop> => {
    const response = await client.get<Shop>(
      `${USER_SERVICE_BASE_URL}/admin/shops/${userId}`
    );
    return response.data;
  },

  // 특정 사용자의 사업자 등록 정보 단건 조회 (없으면 null)
  getBusinessLicenseByUserId: async (
    userId: string
  ): Promise<BusinessLicenseDto | null> => {
    const response = await client.get<BusinessLicenseDto | null>(
      `${USER_SERVICE_BASE_URL}/admin/business-licenses/user/${userId}`
    );
    return response.data;
  },

  // 특정 사용자의 사업자 등록 정보 등록/수정 (upsert)
  upsertBusinessLicenseByUserId: async (
    userId: string,
    dto: BusinessLicenseUpsertDto
  ): Promise<BusinessLicenseDto> => {
    const response = await client.post<BusinessLicenseDto>(
      `${USER_SERVICE_BASE_URL}/admin/business-licenses/user/${userId}`,
      dto
    );
    return response.data;
  },
};
