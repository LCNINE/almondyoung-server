import { USER_SERVICE_BASE_URL } from '@/const';
import { User, UserRolesResponseDto } from '@/lib/types';
import { ApiResponse } from '@/lib/types/dto/api';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

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
  getUserById: async (id: string): Promise<User> => {
    const response: AxiosResponse<ApiResponse<User>> = await client.get(
      `${USER_SERVICE_BASE_URL}/users/${id}`
    );

    return response.data.data;
  },
};
