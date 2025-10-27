#!/usr/bin/env ts-node

/**
 * 쿠팡 발주서 동기화 테스트 스크립트
 *
 * 쿠팡 Strategy의 syncFromChannel 기능을 테스트합니다.
 */

import * as dotenv from 'dotenv';
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { NaverSmartstoreAdapter } from './src/services/adapters/naver-smartstore.adapter';
import { CoupangAdapter } from './src/services/adapters/coupang.adapter';
import { ChannelAdapterFactory } from './src/services/adapters/channel-adapter.factory';
import { AdapterOrchestrationService } from './src/services/adapter-orchestration.service';
import { ChannelAdapterService } from './src/services/channel-adapter.service';

// 환경변수 로드
dotenv.config();

/**
 * 쿠팡 동기화 테스터
 */
class CoupangSyncTester {
  private readonly logger = new Logger('CoupangSyncTester');
  private readonly orchestrator: AdapterOrchestrationService;

  constructor() {
    // 의존성 수동 구성 (기존 테스트와 동일한 방식)
    const httpService = new HttpService();
    const naverAdapter = new NaverSmartstoreAdapter(httpService);
    const coupangAdapter = new CoupangAdapter(httpService);
    const adapterFactory = new ChannelAdapterFactory(
      naverAdapter,
      coupangAdapter,
    );

    this.orchestrator = new AdapterOrchestrationService(adapterFactory);

    this.logger.log('🏗️ 쿠팡 동기화 테스터 초기화 완료');
  }

  /**
   * 쿠팡 발주서 동기화 테스트 실행
   */
  async testSync(): Promise<void> {
    this.logger.log('⚡ 쿠팡 발주서 동기화 테스트 시작');

    try {
      // 환경변수 설정 (실제 쿠팡 API 사용)
      // 실제 쿠팡 API 키가 없으므로 테스트용 값 사용
      process.env.COUPANG_VENDOR_ID =
        process.env.COUPANG_VENDOR_ID || 'A00012345';
      process.env.COUPANG_ACCESS_KEY =
        process.env.COUPANG_ACCESS_KEY || 'test-access-key';
      process.env.COUPANG_SECRET_KEY =
        process.env.COUPANG_SECRET_KEY || 'test-secret-key';
      process.env.COUPANG_API_ENDPOINT = 'https://api-gateway.coupang.com';

      console.log('🔧 환경변수 설정 완료:');
      console.log(`  - COUPANG_VENDOR_ID: ${process.env.COUPANG_VENDOR_ID}`);
      console.log(
        `  - COUPANG_API_ENDPOINT: ${process.env.COUPANG_API_ENDPOINT}`,
      );
      console.log('');

      // 쿠팡 발주서 동기화 실행
      console.log('📡 쿠팡 발주서 동기화 실행...');
      const events = await this.orchestrator.pollAndPublish(
        'coupang',
        'orders',
      );

      console.log('\n📊 동기화 결과:');
      console.log(`  - 총 이벤트 수: ${events.length}건`);

      if (events.length > 0) {
        console.log('\n🔍 첫 번째 이벤트 상세:');
        const firstEvent = events[0];
        console.log(`  - 채널 타입: ${firstEvent.channelType}`);
        console.log(`  - 외부 주문 ID: ${firstEvent.externalOrderId}`);
        console.log(
          `  - 외부 상품 주문 ID: ${firstEvent.externalProductOrderId}`,
        );
        console.log(`  - 상태: ${firstEvent.status}`);
        console.log(`  - 수량: ${firstEvent.quantity}`);
        console.log(`  - 가격: ${firstEvent.priceAmount.toLocaleString()}원`);
        console.log(`  - 주문일: ${firstEvent.createdAt}`);
        console.log(`  - 결제일: ${firstEvent.paymentDate}`);

        if (firstEvent.buyer) {
          console.log('\n👤 구매자 정보:');
          console.log(`  - 이름: ${firstEvent.buyer.name}`);
          console.log(`  - 연락처: ${firstEvent.buyer.contact}`);
          if (firstEvent.buyer.address) {
            console.log(
              `  - 주소: ${firstEvent.buyer.address.roadAddress} ${firstEvent.buyer.address.detailAddress}`,
            );
            console.log(`  - 우편번호: ${firstEvent.buyer.address.postalCode}`);
          }
        }

        if (firstEvent.dispatch) {
          console.log('\n📦 배송 정보:');
          console.log(`  - 배송 방법: ${firstEvent.dispatch.deliveryMethod}`);
          console.log(`  - 택배사: ${firstEvent.dispatch.deliveryCompanyCode}`);
          console.log(`  - 송장번호: ${firstEvent.dispatch.trackingNumber}`);
          console.log(`  - 발송일: ${firstEvent.dispatch.dispatchedAt}`);
        }

        // 상태별 분포 통계
        const statusDistribution: Record<string, number> = {};
        events.forEach((event) => {
          statusDistribution[event.status] =
            (statusDistribution[event.status] || 0) + 1;
        });

        console.log('\n📈 상태별 분포:');
        Object.entries(statusDistribution).forEach(([status, count]) => {
          console.log(`  - ${status}: ${count}건`);
        });
      }

      this.logger.log('✅ 쿠팡 발주서 동기화 테스트 성공');
    } catch (error) {
      this.logger.error('❌ 쿠팡 발주서 동기화 테스트 실패:', error);
      throw error;
    }
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log('🎯 쿠팡 발주서 동기화 테스트 시작\n');

  try {
    const tester = new CoupangSyncTester();
    await tester.testSync();

    console.log('\n🎉 쿠팡 발주서 동기화 테스트 완료!');
  } catch (error) {
    console.error('\n❌ 테스트 실행 중 오류 발생:', error);
    console.error('스택 트레이스:', error.stack);
    process.exit(1);
  }
}

// 스크립트 실행
main();
