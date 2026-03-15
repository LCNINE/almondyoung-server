import { USER_SERVICE_BASE_URL } from '@/const';
import { User, UserRolesResponseDto } from '@/lib/types';
import { ApiResponse } from '@/lib/types/dto/api';
import { AdminUserDetailDto, AdminUsersQuery, AdminUsersResponse } from '@/lib/types/dto/user';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

function buildQueryString(query: AdminUsersQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

/**
 * 클라이언트용 사용자 API
 */
export const userApi = {
  getMe: async (): Promise<User> => {
    const response: AxiosResponse<ApiResponse<User>> = await client.get(
      `${USER_SERVICE_BASE_URL}/users/me`
    );

    return response.data.data;
  },

  getMyRoles: async (): Promise<UserRolesResponseDto> => {
    const response: AxiosResponse<ApiResponse<UserRolesResponseDto>> =
      await client.get(`${USER_SERVICE_BASE_URL}/users/roles`);

    return response.data.data;
  },

  // 해당 id로 관리자 사용자 정보 조회
  getUserById: async (id: string): Promise<AdminUserDetailDto> => {
    const response: AxiosResponse<ApiResponse<AdminUserDetailDto>> = await client.get(
      `${USER_SERVICE_BASE_URL}/admin/users/${id}`
    );

    return response.data.data;
  },

  // 어드민 - 전체 사용자 목록 조회
  getAdminUsers: async (query: AdminUsersQuery): Promise<AdminUsersResponse> => {
    const qs = buildQueryString(query);
    const response: AxiosResponse<ApiResponse<AdminUsersResponse>> = await client.get(
      `${USER_SERVICE_BASE_URL}/admin/users${qs ? `?${qs}` : ''}`
    );
    return response.data.data;
  },
};
