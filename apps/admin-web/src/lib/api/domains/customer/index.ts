// Users 도메인 통합 클라이언트

import { USER_SERVICE_BASE_URL } from '@/const';
import { Shop, User } from '@/lib/types';
import { ApiResponse } from '@/lib/types/dto/api';
import {
  CustomerBusinessLicense,
  CustomerBusinessLicenseQueryDto,
  CustomerConsent,
  CustomerProfile,
} from '@/lib/types/dto/customers';
import { client } from '../../client';

// User Service API 클라이언트

export const customerApi = {
  // 사용자들 조회
  getCustomers: async (): Promise<ApiResponse<User[]>> => {
    const response = await client.get<ApiResponse<User[]>>(
      `${USER_SERVICE_BASE_URL}/users`
    );
    return response.data;
  },

  // 사용자id로 사용자 정보 조회
  getCustomerById: async (
    id: string
  ): Promise<ApiResponse<CustomerProfile>> => {
    const response = await client.get<ApiResponse<CustomerProfile>>(
      `${USER_SERVICE_BASE_URL}/users/detail/${id}`
    );
    return response.data;
  },

  // 이메일로 사용자 찾기
  findCustomerByEmail: async (email: string): Promise<ApiResponse<User>> => {
    const response = await client.get<ApiResponse<User>>(
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
  }): Promise<ApiResponse<CustomerConsent[]>> => {
    const response = await client.get<ApiResponse<CustomerConsent[]>>(
      `${USER_SERVICE_BASE_URL}/users/consents`,
      { params: query }
    );

    return response.data;
  },

  // 사업자 등록증 목록 조회
  getBusinessLicenses: async (
    query: CustomerBusinessLicenseQueryDto
  ): Promise<ApiResponse<CustomerBusinessLicense[]>> => {
    const response = await client.get<ApiResponse<CustomerBusinessLicense[]>>(
      `${USER_SERVICE_BASE_URL}/users/business-licenses`,
      { params: query }
    );
    return response.data;
  },

  // 쇼핑몰 정보 조회
  getShopByUserId: async (userId: string): Promise<ApiResponse<Shop>> => {
    const response = await client.get<ApiResponse<Shop>>(
      `${USER_SERVICE_BASE_URL}/admin/shops/${userId}`
    );
    return response.data;
  },
};
