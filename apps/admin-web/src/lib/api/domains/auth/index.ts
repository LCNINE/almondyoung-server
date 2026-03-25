import { ApiResponse } from '@/lib/types/dto/api';
import { client } from '../../client';

export const authApi = {
  signin: async (
    loginId: string,
    password: string,
    rememberMe?: boolean
  ): Promise<ApiResponse<string>> => {
    const response = await client.post<ApiResponse<string>>('auth/signin', {
      loginId,
      password,
      rememberMe,
    });

    return response.data;
  },
  signout: async () => {
    const response = await client.post('auth/signout');
    return response.data;
  },
};
