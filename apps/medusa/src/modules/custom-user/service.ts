import axios, { AxiosInstance } from 'axios';
import { User, UserRole, UserServiceResponse } from '../../types/user.type';
import { MedusaService } from '@medusajs/framework/utils';
import { CreateUserDTO } from '@medusajs/framework/types';

export default class CustomUserModuleService {
  private client: AxiosInstance;

  constructor() {
    const baseUrl = process.env.USER_SERVICE_URL;

    if (!baseUrl) {
      throw new Error('USER_SERVICE_URL이 설정되어 있지 않습니다.');
    }

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });
  }

  async login(credentials: {
    loginId: string;
    password: string;
  }): Promise<{ accessToken: string }> {
    try {
      const response = await this.client.post<
        UserServiceResponse<{ accessToken: string }>
      >('/auth/signin', credentials);

      return response.data.data;
    } catch (error) {
      throw new Error(`로그인 실패: ${error.response?.data.message}`);
    }
  }

  async retrieveUser(userId: string): Promise<User> {
    try {
      const response = await this.client.get<UserServiceResponse<User>>(
        `/users/${userId}`,
      );

      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Axios 응답 에러:',
          error.response?.status,
          error.response?.data,
        );
      } else {
        console.error('Unknown Error:', error);
      }
      throw new Error(`유저 정보 조회 실패`);
    }
  }

  async retrieveUserByEmail(email: string): Promise<UserServiceResponse<User>> {
    try {
      const response = await this.client.get<UserServiceResponse<User>>(
        `/users/find-by-email?email=${email}`,
      );
      return response.data;
    } catch (error) {
      throw new Error(`유저 이메일 조회 실패: ${error}`);
    }
  }

  async getUserDetailsByToken(userServiceToken: string): Promise<User> {
    try {
      const response = await this.client.get<UserServiceResponse<User>>(
        `/users/details`,
        {
          headers: {
            Authorization: `Bearer ${userServiceToken}`,
          },
        },
      );

      return response.data.data;
    } catch (error) {
      throw new Error(`유저 정보 조회 실패: ${error.response?.data.message}`);
    }
  }

  async restoreToken(): Promise<{ accessToken: string }> {
    try {
      const response = await this.client.post<
        UserServiceResponse<{ accessToken: string }>
      >('/auth/restore-token');
      return response.data.data;
    } catch (error) {
      throw new Error(`토큰 갱신 실패: ${error.response?.data.message}`);
    }
  }

  async getUserRoles(
    userId: string,
    userServiceToken: string,
  ): Promise<UserRole> {
    try {
      const response = await this.client.get<UserServiceResponse<UserRole>>(
        `/users/roles/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${userServiceToken}`,
          },
        },
      );

      return response.data.data;
    } catch (error) {
      throw new Error(`유저 역할 조회 실패: ${error.response?.data.message}`);
    }
  }
}
