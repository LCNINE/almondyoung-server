import axios, { AxiosInstance } from 'axios';

export default class UserModuleService {
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
    });
  }

  async getUserById(id: string) {
    try {
      const response = await this.client.get(`/api/users/${id}`);
      return response.data;
    } catch (error) {
      throw new Error(`유저 정보 조회 실패: ${error}`);
    }
  }

  async getUserByEmail(email: string) {
    try {
      const response = await this.client.get(`/api/users`, {
        params: { email },
      });
      return response.data;
    } catch (error) {
      throw new Error(`유저 이메일 조회 실패: ${error}`);
    }
  }
}
