import axios, { AxiosInstance } from 'axios';

type Options = {
  apiKey: string;
  baseUrl: string;
};

export default class UserModuleService {
  private options: Options;
  private client: AxiosInstance;

  constructor({}, options: Options) {
    this.options = options;

    // 외부 user-service와 통신하는 axios client 초기화
    this.client = axios.create({
      baseURL: options.baseUrl,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getUserById(id: string) {
    try {
      const response = await this.client.get(`/api/users/${id}`);
      return response.data;
    } catch (error) {
      throw new Error(`유저 정보 조회 실패: ${error.message}`);
    }
  }

  async getUserByEmail(email: string) {
    try {
      const response = await this.client.get(`/api/users`, {
        params: { email },
      });
      return response.data;
    } catch (error) {
      throw new Error(`유저 이메일 조회 실패: ${error.message}`);
    }
  }
}
