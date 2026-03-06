import { USER_SERVICE_BASE_URL } from '@/const';
import { User, UserRolesResponseDto } from '@/lib/types';
import { ApiResponse } from '@/lib/types/dto/api';
import { AxiosResponse } from 'axios';
import { server } from '../../server';

export const serverUserApi = {
  getMe: async (): Promise<User> => {
    const response: AxiosResponse<ApiResponse<User>> = await server.get(
      `${USER_SERVICE_BASE_URL}/users/me`
    );

    return response.data.data;
  },

  getMyRoles: async (): Promise<UserRolesResponseDto> => {
    const response: AxiosResponse<ApiResponse<UserRolesResponseDto>> =
      await server.get(`${USER_SERVICE_BASE_URL}/users/roles`);

    return response.data.data;
  },
};
