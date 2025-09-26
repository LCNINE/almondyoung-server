#!/usr/bin/env ts-node

/**
 * 네이버 스마트스토어 API 액세스 토큰 발급 테스트
 *
 * 사용법:
 * 1. .env 파일에 네이버 API 인증 정보 설정
 * 2. npm run test:naver-token 또는 ts-node test-naver-token.ts
 */

import * as dotenv from 'dotenv';
import axios from 'axios';
import * as bcrypt from 'bcrypt';
import * as path from 'path';

// 환경변수 로드 (프로젝트 루트의 .env 파일)
dotenv.config();

interface NaverTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

class NaverApiTester {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly accountId: string;
  private readonly apiEndpoint: string;

  constructor() {
    this.clientId = process.env.NAVER_CLIENT_ID || '';
    this.clientSecret = process.env.NAVER_CLIENT_SECRET || '';
    this.accountId = process.env.NAVER_ACCOUNT_ID || '';
    this.apiEndpoint =
      process.env.NAVER_API_ENDPOINT ||
      'https://api.commerce.naver.com/external/v1';

    console.log('🔧 환경변수 확인:');
    console.log(
      `   NAVER_CLIENT_ID: ${this.clientId ? '✅ 설정됨' : '❌ 누락'}`,
    );
    console.log(
      `   NAVER_CLIENT_SECRET: ${this.clientSecret ? '✅ 설정됨' : '❌ 누락'}`,
    );
    console.log(
      `   NAVER_ACCOUNT_ID: ${this.accountId ? '✅ 설정됨' : '❌ 누락'}`,
    );
    console.log(`   NAVER_API_ENDPOINT: ${this.apiEndpoint}`);
    console.log('');

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        '❌ NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되지 않았습니다.',
      );
    }
  }

  /**
   * 네이버 API 액세스 토큰 발급
   */
  async getAccessToken(): Promise<string> {
    try {
      console.log('🚀 네이버 API 액세스 토큰 발급 시작...');

      // 1. 현재 시각(밀리초)
      const timestamp = Date.now().toString();
      console.log(`   Timestamp: ${timestamp}`);

      // 2. 전자서명 생성 (bcrypt 해싱)
      // password: client_id + "_" + timestamp
      const password = `${this.clientId}_${timestamp}`;
      // bcrypt 해싱 (client_secret을 salt로 사용)
      const hashed = bcrypt.hashSync(password, this.clientSecret);
      // Base64 인코딩
      const clientSecretSign = Buffer.from(hashed, 'utf-8').toString('base64');

      console.log(`   Password: ${password}`);
      console.log(`   Hashed: ${hashed}`);
      console.log(`   Client Secret Sign: ${clientSecretSign}`);

      // 3. 요청 파라미터 구성
      const params = new URLSearchParams([
        ['grant_type', 'client_credentials'],
        ['client_id', this.clientId],
        ['timestamp', timestamp],
        ['client_secret_sign', clientSecretSign],
        ['type', 'SELF'], // 우선 SELF 타입으로 시도
      ]);

      // SELF 타입에서는 account_id 제외
      // 스코프 추가 (URL 인코딩된 형태)
      params.append('scope', '상품주문.조회 상품주문.처리');

      console.log('📤 토큰 발급 요청 전송...');
      console.log(
        `   URL: https://api.commerce.naver.com/external/v1/oauth2/token`,
      );
      console.log(`   Body: ${params.toString()}`);

      // 4. API 호출
      const response = await axios.post<NaverTokenResponse>(
        'https://api.commerce.naver.com/external/v1/oauth2/token',
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Channel-Adapter/1.0',
          },
          timeout: 10000, // 10초 타임아웃
        },
      );

      console.log('✅ 토큰 발급 성공!');
      console.log(
        `   Access Token: ${response.data.access_token.substring(0, 20)}...`,
      );
      console.log(`   Token Type: ${response.data.token_type}`);
      console.log(`   Expires In: ${response.data.expires_in}초`);
      console.log(`   Scope: ${response.data.scope || 'N/A'}`);

      return response.data.access_token;
    } catch (error) {
      console.error('❌ 토큰 발급 실패:');

      if (axios.isAxiosError(error)) {
        console.error(`   HTTP Status: ${error.response?.status}`);
        console.error(`   Error Response:`, error.response?.data);
        console.error(`   Request Config:`, {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers,
        });
      } else {
        console.error(`   Error: ${error}`);
      }

      throw error;
    }
  }

  /**
   * 발급받은 토큰으로 간단한 API 테스트
   */
  async testApiCall(accessToken: string): Promise<void> {
    try {
      console.log('\n🧪 토큰 유효성 테스트 - 주문 상태 변경 목록 조회...');

      const response = await axios.get(
        `${this.apiEndpoint}/product-orders/last-changed-statuses`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          params: {
            lastChangedFrom: new Date(
              Date.now() - 24 * 60 * 60 * 1000,
            ).toISOString(), // 24시간 전
            lastChangedTo: new Date().toISOString(),
          },
          timeout: 10000,
        },
      );

      console.log('✅ API 호출 성공!');
      console.log(`   Response Status: ${response.status}`);
      console.log(`   Response Data:`, JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('❌ API 호출 실패:');

      if (axios.isAxiosError(error)) {
        console.error(`   HTTP Status: ${error.response?.status}`);
        console.error(`   Error Response:`, error.response?.data);
      } else {
        console.error(`   Error: ${error}`);
      }

      // API 호출 실패는 토큰 발급 성공과는 별개이므로 throw하지 않음
    }
  }
}

// 메인 실행 함수
async function main() {
  try {
    console.log('🎯 네이버 스마트스토어 API 토큰 발급 테스트 시작\n');

    const tester = new NaverApiTester();

    // 1. 액세스 토큰 발급
    const accessToken = await tester.getAccessToken();

    // 2. 토큰으로 간단한 API 테스트
    await tester.testApiCall(accessToken);

    console.log('\n🎉 테스트 완료!');
  } catch (error) {
    console.error('\n💥 테스트 실패:', error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시에만 main 함수 호출
if (require.main === module) {
  main();
}

export { NaverApiTester };
