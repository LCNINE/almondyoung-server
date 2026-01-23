import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcrypt';
import { NaverBaseClient } from './naver-base.client';

// TODO: 추후 naver-api.types.ts 파일로 이동할 타입
/** OAuth 토큰 발급 API 응답 타입 */
interface NaverTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

@Injectable()
export class NaverAuthService extends NaverBaseClient {
  // TODO: 리팩토링 2단계 - 토큰 캐싱 로직 추가
  // private accessToken: string | null = null;
  // private tokenExpiry: number | null = null;

  constructor(protected readonly http: HttpService) {
    // 부모 클래스(NaverBaseClient)의 생성자에 Logger 이름을 전달합니다.
    super(http, NaverAuthService.name);
  }

  /**
   * 네이버 커머스 API 액세스 토큰을 발급받습니다.
   * (기존 NaverCommerceApiService.getAccessToken() 로직과 동일)
   * @returns 액세스 토큰 문자열
   */
  async getAccessToken(): Promise<string> {
    // TODO: 리팩토링 2단계 - 캐시된 유효한 토큰이 있으면 즉시 반환하는 로직 추가
    // if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
    //   this.logger.debug('캐시된 액세스 토큰 사용');
    //   return this.accessToken;
    // }

    this.logger.log('네이버 커머스 API 액세스 토큰 발급 요청');
    const timestamp = Date.now().toString();
    const clientId = process.env.NAVER_CLIENT_ID ?? '';
    const clientSecret = process.env.NAVER_CLIENT_SECRET ?? '';

    // 네이버 API 전자서명 생성 방식
    // 1. password: client_id + "_" + timestamp
    const password = `${clientId}_${timestamp}`;

    // 2. client_secret은 bcrypt salt 형식이어야 함 (예: $2a$10$abcdefghijklmnopqrstuv)
    // Mock 환경에서는 유효한 bcrypt salt를 생성
    let salt = clientSecret;
    if (!salt.startsWith('$2a$') && !salt.startsWith('$2b$')) {
      // Mock 환경: 유효한 bcrypt salt 생성
      salt = bcrypt.genSaltSync(10);
      this.logger.debug(
        `Mock 환경: bcrypt salt 생성됨 ${salt.substring(0, 10)}...`,
      );
    }

    // 3. bcrypt 해싱
    const hashed = bcrypt.hashSync(password, salt);

    // 4. Base64 인코딩
    const clientSecretSign = Buffer.from(hashed, 'utf-8').toString('base64');
    const params = new URLSearchParams([
      ['grant_type', 'client_credentials'],
      ['client_id', clientId],
      ['timestamp', timestamp],
      ['client_secret_sign', clientSecretSign],
      ['type', 'SELF'],
    ]);
    const res = await firstValueFrom(
      this.http.post<NaverTokenResponse>(
        `${this.apiBaseUrl}/oauth2/token`,
        params,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );

    this.logger.log('✅ 액세스 토큰 발급 성공');

    // TODO: 리팩토링 2단계 - 발급받은 토큰과 만료 시간 캐싱
    // this.accessToken = res.data.access_token;
    // this.tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000; // 만료 1분 전

    return res.data.access_token;
  }
}
