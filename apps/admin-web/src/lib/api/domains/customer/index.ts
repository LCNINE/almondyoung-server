'use client';

// Customer 도메인 API 클라이언트

import { USER_SERVICE_BASE_URL } from '@/const';
import { RoleDto, Shop, User } from '@/lib/types';
import {
  AdminUpdateBusinessLicenseDto,
  AdminUpdateUserDto,
  CustomerBusinessLicense,
  CustomerBusinessLicenseQueryDto,
  CustomerConsent,
  CustomerListQuery,
  CustomerListResponse,
  CustomerProfile,
} from '@/lib/types/dto/customers';
import { client } from '../../client';

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

  // 회원 기본정보 수정
  updateUser: async (
    userId: string,
    dto: AdminUpdateUserDto
  ): Promise<CustomerProfile> => {
    const response = await client.patch<CustomerProfile>(
      `${USER_SERVICE_BASE_URL}/admin/users/${userId}`,
      dto
    );
    return response.data;
  },

  // 단일 회원 동의 현황 조회 (미동의 시 null)
  getUserConsent: async (userId: string): Promise<CustomerConsent | null> => {
    const response = await client.get<CustomerConsent | null>(
      `${USER_SERVICE_BASE_URL}/admin/users/consent/${userId}`
    );
    return response.data;
  },

  // 단일 회원 사업자등록증 조회
  getBusinessLicenseByUser: async (
    userId: string
  ): Promise<CustomerBusinessLicense | null> => {
    const response = await client.get<CustomerBusinessLicense | null>(
      `${USER_SERVICE_BASE_URL}/admin/business-licenses/user/${userId}`
    );
    return response.data;
  },

  // 사업자등록증 심사 수정 (상태/코멘트)
  updateBusinessLicense: async (
    businessId: string,
    dto: AdminUpdateBusinessLicenseDto
  ): Promise<CustomerBusinessLicense> => {
    const response = await client.put<CustomerBusinessLicense>(
      `${USER_SERVICE_BASE_URL}/admin/business-licenses/${businessId}`,
      dto
    );
    return response.data;
  },

  // 회원의 역할 목록 조회 ({ roles: RoleDto[] })
  getUserRoles: async (userId: string): Promise<RoleDto[]> => {
    const response = await client.get<{ roles: RoleDto[] }>(
      `${USER_SERVICE_BASE_URL}/admin/users/${userId}/roles`
    );
    return response.data?.roles ?? [];
  },

  // 회원의 역할 일괄 교체
  setUserRoles: async (userId: string, roleIds: string[]): Promise<void> => {
    await client.put(`${USER_SERVICE_BASE_URL}/admin/users/${userId}/roles`, {
      roleIds,
    });
  },
};
