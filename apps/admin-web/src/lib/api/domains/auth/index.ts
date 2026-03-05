import { ApiResponse } from '@/lib/types/dto/api';
import { client } from '../../client';
import { USER_SERVICE_BASE_URL } from '@/const';

export const authApi = {
  signin: async (
    loginId: string,
    password: string,
    rememberMe?: boolean
  ): Promise<ApiResponse<string>> => {
    const response = await client.post<ApiResponse<string>>(
      `${USER_SERVICE_BASE_URL}/auth/signin`,
      {
        loginId,
        password,
        rememberMe,
      }
    );

    return response.data;
  },
  signout: async () => {
    const response = await client.post(`${USER_SERVICE_BASE_URL}/auth/signout`);
    return response.data;
  },
};
