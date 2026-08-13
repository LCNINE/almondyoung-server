#!/usr/bin/env ts-node

/**
 * 네이버 스마트스토어 주문 동기화 테스트
 *
 * 사용법:
 * 1. .env 파일에 네이버 API 인증 정보 설정
 * 2. npm run test:naver-sync 또는 ts-node test-naver-sync.ts
 */

import * as dotenv from 'dotenv';
import { HttpService } from '@nestjs/axios';
import { NaverSmartstoreAdapter } from './src/services/adapters/naver-smartstore.adapter';
import { NaverCommerceApiService } from './src/services/apis/naver-commerce.api.service';
import * as path from 'path';

// 환경변수 로드 (프로젝트 루트의 .env 파일)
dotenv.config();

class NaverSyncTester {
  private readonly adapter: NaverSmartstoreAdapter;

  constructor() {
    // HttpService와 NaverCommerceApiService 인스턴스 생성
    const httpService = new HttpService();
    const naverApiService = new NaverCommerceApiService(httpService);
    this.adapter = new NaverSmartstoreAdapter(naverApiService);

    console.log('🔧 환경변수 확인:');
    console.log(`   NAVER_CLIENT_ID: ${process.env.NAVER_CLIENT_ID ? '✅ 설정됨' : '❌ 누락'}`);
    console.log(`   NAVER_CLIENT_SECRET: ${process.env.NAVER_CLIENT_SECRET ? '✅ 설정됨' : '❌ 누락'}`);
    console.log(
      `   NAVER_API_ENDPOINT: ${process.env.NAVER_API_ENDPOINT || 'https://api.commerce.naver.com/external/v1'}`,
    );
    console.log('');

    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      throw new Error('❌ NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되지 않았습니다.');
    }
  }

  /**
   * 네이버 주문 동기화 테스트
   */
  async testOrderSync(): Promise<void> {
    try {
      console.log('🚀 네이버 주문 동기화 테스트 시작...');

      // syncFromChannel 메서드 호출
      const events = await this.adapter.syncFromChannel('orders');

      console.log(`📋 동기화 결과: ${events.length}건의 주문 이벤트`);

      if (events.length > 0) {
        console.log('\n📝 첫 번째 이벤트 상세:');
        console.log(JSON.stringify(events[0], null, 2));

        console.log('\n📊 이벤트 요약:');
        events.forEach((event, index) => {
          console.log(`   ${index + 1}. ${event.externalOrderId} - ${event.status} (${event.lastChangedType})`);
        });
      }

      console.log('\n✅ 동기화 테스트 완료!');
    } catch (error) {
      console.error('\n❌ 동기화 테스트 실패:', error);

      if (error.response) {
        console.error('   HTTP Status:', error.response.status);
        console.error('   Response Data:', JSON.stringify(error.response.data, null, 2));
      }

      throw error;
    }
  }

  /**
   * 네이버 API 응답 구조 테스트 (토큰 발급만)
   */
  async testTokenOnly(): Promise<void> {
    try {
      console.log('🔑 네이버 API 토큰 발급 테스트...');

      // private 메서드에 접근하기 위해 any로 캐스팅
      const token = await (this.adapter as any).getAccessToken();

      console.log(`✅ 토큰 발급 성공: ${token.substring(0, 20)}...`);
    } catch (error) {
      console.error('❌ 토큰 발급 실패:', error);
      throw error;
    }
  }
}

// 메인 실행 함수
async function main() {
  try {
    console.log('🎯 네이버 스마트스토어 주문 동기화 테스트 시작\n');

    const tester = new NaverSyncTester();

    // 명령행 인수에 따라 테스트 모드 선택
    const testMode = process.argv[2] || 'sync';

    if (testMode === 'token') {
      console.log('🔑 토큰 발급 테스트 모드\n');
      await tester.testTokenOnly();
    } else {
      console.log('🔄 전체 동기화 테스트 모드\n');
      await tester.testOrderSync();
    }

    console.log('\n🎉 모든 테스트 완료!');
  } catch (error) {
    console.error('\n💥 테스트 실패:', error.message || error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시에만 main 함수 호출
if (require.main === module) {
  main();
}

export { NaverSyncTester };
