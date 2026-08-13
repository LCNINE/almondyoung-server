#!/usr/bin/env ts-node

/**
 * 채널 어댑터 오케스트레이션 서비스 통합 테스트
 *
 * AdapterOrchestrationService와 ChannelAdapterService의 전체 플로우를 테스트합니다.
 * 실제 네이버 API를 사용하여 폴링, 웹훅 처리, 명령 실행 등을 검증합니다.
 *
 * @author Channel Adapter Team
 * @version 1.0.0
 *
 * @example
 * ```bash
 * # 전체 통합 테스트 실행
 * npm run test:orchestration
 *
 * # 특정 테스트만 실행
 * npm run test:orchestration poll    # 폴링 테스트만
 * npm run test:orchestration webhook # 웹훅 테스트만
 * npm run test:orchestration command # 명령 실행 테스트만
 * ```
 */

import * as dotenv from 'dotenv';
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { NaverSmartstoreAdapter } from './src/services/adapters/naver-smartstore.adapter';
import { CoupangAdapter } from './src/services/adapters/coupang.adapter';
import { ChannelAdapterFactory } from './src/services/adapters/channel-adapter.factory';
import { AdapterOrchestrationService } from './src/services/adapter-orchestration.service';
import { ChannelAdapterService } from './src/services/channel-adapter.service';
import { SyncStatusService } from './src/services/sync-status.service';
import { NaverCommerceApiService } from './src/services/apis/naver-commerce.api.service';
// 환경변수 로드
dotenv.config();

/**
 * 채널 어댑터 오케스트레이션 통합 테스터
 *
 * 실제 서비스 환경과 유사한 조건에서 전체 플로우를 테스트합니다.
 * 의존성 주입을 수동으로 구성하여 NestJS 없이도 테스트가 가능합니다.
 */
class OrchestrationTester {
  private readonly logger = new Logger('OrchestrationTester');
  private readonly channelAdapter: ChannelAdapterService;
  private readonly orchestrator: AdapterOrchestrationService;

  constructor() {
    // 의존성 수동 구성
    const httpService = new HttpService();
    const naverApiService = new NaverCommerceApiService(httpService);
    const naverAdapter = new NaverSmartstoreAdapter(naverApiService);
    const coupangAdapter = new CoupangAdapter(httpService);
    const factory = new ChannelAdapterFactory(naverAdapter, coupangAdapter);

    this.orchestrator = new AdapterOrchestrationService(factory, new SyncStatusService());
    this.channelAdapter = new ChannelAdapterService(this.orchestrator);

    this.logger.log('🏗️ 오케스트레이션 테스터 초기화 완료');
  }

  /**
   * 폴링 기능 통합 테스트
   *
   * 네이버 스마트스토어에서 실제 주문 데이터를 폴링하고
   * 전체 변환 과정이 정상적으로 작동하는지 확인합니다.
   */
  async testPolling(): Promise<void> {
    this.logger.log('🔄 폴링 통합 테스트 시작');

    try {
      // 1. ChannelAdapterService를 통한 폴링 테스트
      const events = await this.channelAdapter.poll('naver_smartstore', 'orders');

      this.logger.log(`✅ 폴링 테스트 성공: ${events.length}건의 이벤트 수신`);

      if (events.length > 0) {
        this.logger.log('📋 첫 번째 이벤트 상세:');
        console.log(JSON.stringify(events[0], null, 2));

        // 이벤트 유효성 검증
        const firstEvent = events[0];
        const isValid = this.validateInternalOrderEvent(firstEvent);

        if (isValid) {
          this.logger.log('✅ 이벤트 구조 유효성 검증 통과');
        } else {
          throw new Error('❌ 이벤트 구조 유효성 검증 실패');
        }
      }

      // 2. 직접 오케스트레이터를 통한 폴링 테스트
      const directEvents = await this.orchestrator.pollAndPublish('naver_smartstore', 'orders');
      this.logger.log(`✅ 직접 오케스트레이터 폴링 성공: ${directEvents.length}건`);
    } catch (error) {
      this.logger.error('❌ 폴링 테스트 실패:', error.message);
      throw error;
    }
  }

  /**
   * 웹훅 처리 기능 테스트
   *
   * 모의 웹훅 페이로드를 생성하여 전체 처리 과정을 테스트합니다.
   */
  async testWebhookHandling(): Promise<void> {
    this.logger.log('📨 웹훅 처리 테스트 시작');

    try {
      // 모의 네이버 웹훅 페이로드
      const mockNaverWebhook = {
        orderId: 'TEST_ORDER_001',
        productOrderId: 'TEST_PRODUCT_ORDER_001',
        status: 'PAYED',
        timestamp: new Date().toISOString(),
      };

      // 1. ChannelAdapterService를 통한 웹훅 처리
      const events = await this.channelAdapter.incoming('naver_smartstore', mockNaverWebhook);

      this.logger.log(`✅ 웹훅 처리 테스트 성공: ${events.length}건의 이벤트 생성`);

      if (events.length > 0) {
        this.logger.log('📋 변환된 이벤트:');
        console.log(JSON.stringify(events[0], null, 2));
      }

      // 2. 모의 쿠팡 웹훅 페이로드
      const mockCoupangWebhook = {
        orderId: 'COUPANG_ORDER_001',
        status: 'SHIPPED',
        timestamp: new Date().toISOString(),
      };

      const coupangEvents = await this.channelAdapter.incoming('coupang', mockCoupangWebhook);
      this.logger.log(`✅ 쿠팡 웹훅 처리 성공: ${coupangEvents.length}건`);
    } catch (error) {
      this.logger.error('❌ 웹훅 처리 테스트 실패:', error.message);
      throw error;
    }
  }

  /**
   * 명령 실행 기능 테스트
   *
   * 다양한 채널별 명령을 실행하여 전체 플로우를 검증합니다.
   */
  async testCommandExecution(): Promise<void> {
    this.logger.log('⚡ 명령 실행 테스트 시작');

    try {
      // 1. 네이버 발송처리 명령 테스트 (실제 형식과 유사한 테스트 데이터)
      const dispatchCommand = {
        type: 'dispatch.confirm' as const,
        orderId: '2025091550078121', // 실제 네이버 주문번호 형식
        productOrderIds: ['2025091565429621'], // 실제 네이버 상품주문번호 형식
        tracking: {
          companyCode: 'CJ',
          number: '1234567890123',
        },
        dispatchedAt: new Date().toISOString(),
      };

      const dispatchResult = await this.channelAdapter.command('naver_smartstore', dispatchCommand);
      this.logger.log(`✅ 네이버 발송처리 명령 테스트: ${dispatchResult.success ? '성공' : '실패'}`);

      // 2. 쿠팡 취소승인 명령 테스트
      const cancelCommand = {
        type: 'cancel.approve' as const,
        orderId: 'COUPANG_ORDER_001',
      };

      const cancelResult = await this.channelAdapter.command('coupang', cancelCommand);
      this.logger.log(`✅ 쿠팡 취소승인 명령 테스트: ${cancelResult.success ? '성공' : '실패'}`);

      // 3. 직접 오케스트레이터를 통한 명령 실행
      const directResult = await this.orchestrator.execute('naver_smartstore', dispatchCommand);
      this.logger.log(`✅ 직접 오케스트레이터 명령 실행: ${directResult.success ? '성공' : '실패'}`);
    } catch (error) {
      this.logger.error('❌ 명령 실행 테스트 실패:', error.message);
      throw error;
    }
  }

  /**
   * 전체 채널 동기화 테스트
   *
   * 모든 채널에서 동시에 데이터를 동기화하는 기능을 테스트합니다.
   */
  async testSyncAllChannels(): Promise<void> {
    this.logger.log('🌐 전체 채널 동기화 테스트 시작');

    try {
      const results = await this.channelAdapter.syncAll('orders');

      this.logger.log(`✅ 전체 채널 동기화 완료: ${results.length}개 채널`);

      results.forEach((result) => {
        if (result.success) {
          this.logger.log(`  ✅ ${result.channel}: ${result.events.length}건 동기화 성공`);
        } else {
          this.logger.warn(`  ⚠️ ${result.channel}: 동기화 실패 - ${result.error}`);
        }
      });

      const totalEvents = results.reduce((sum, r) => sum + r.events.length, 0);
      const successCount = results.filter((r) => r.success).length;

      this.logger.log(`📊 동기화 요약: ${successCount}/${results.length}개 채널 성공, 총 ${totalEvents}건 이벤트`);
    } catch (error) {
      this.logger.error('❌ 전체 채널 동기화 테스트 실패:', error.message);
      throw error;
    }
  }

  /**
   * 서비스 상태 확인 테스트
   */
  async testHealthCheck(): Promise<void> {
    this.logger.log('🏥 헬스체크 테스트 시작');

    try {
      const status = await this.channelAdapter.getHealthStatus();
      this.logger.log(`✅ 헬스체크 성공: ${status.isHealthy ? '정상' : '비정상'}`);
      console.log('서비스 상태:', JSON.stringify(status, null, 2));
    } catch (error) {
      this.logger.error('❌ 헬스체크 테스트 실패:', error.message);
      throw error;
    }
  }

  /**
   * InternalOrderEvent 구조 유효성 검증
   */
  private validateInternalOrderEvent(event: any): boolean {
    const requiredFields = ['channelType', 'externalOrderId', 'status', 'quantity', 'priceAmount'];

    return requiredFields.every((field) => event[field] !== undefined);
  }

  /**
   * 전체 통합 테스트 실행
   */
  async runAllTests(): Promise<void> {
    const tests = [
      { name: '폴링', fn: () => this.testPolling() },
      { name: '웹훅 처리', fn: () => this.testWebhookHandling() },
      { name: '명령 실행', fn: () => this.testCommandExecution() },
      { name: '전체 채널 동기화', fn: () => this.testSyncAllChannels() },
      { name: '헬스체크', fn: () => this.testHealthCheck() },
    ];

    let passedTests = 0;
    const failedTests: string[] = [];

    for (const test of tests) {
      try {
        this.logger.log(`\n🧪 [${test.name}] 테스트 시작`);
        await test.fn();
        this.logger.log(`✅ [${test.name}] 테스트 통과`);
        passedTests++;
      } catch (error) {
        this.logger.error(`❌ [${test.name}] 테스트 실패:`, error.message);
        failedTests.push(test.name);
      }
    }

    this.logger.log(`\n📊 테스트 결과 요약:`);
    this.logger.log(`  ✅ 통과: ${passedTests}/${tests.length}개`);
    this.logger.log(`  ❌ 실패: ${failedTests.length}개`);

    if (failedTests.length > 0) {
      this.logger.log(`  실패한 테스트: ${failedTests.join(', ')}`);
    }
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  try {
    console.log('🎯 채널 어댑터 오케스트레이션 통합 테스트 시작\n');

    // 환경변수 확인
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      throw new Error('❌ 네이버 API 인증 정보가 설정되지 않았습니다.');
    }

    const tester = new OrchestrationTester();
    const testType = process.argv[2] || 'all';

    switch (testType) {
      case 'poll':
        await tester.testPolling();
        break;
      case 'webhook':
        await tester.testWebhookHandling();
        break;
      case 'command':
        await tester.testCommandExecution();
        break;
      case 'sync':
        await tester.testSyncAllChannels();
        break;
      case 'health':
        await tester.testHealthCheck();
        break;
      case 'all':
      default:
        await tester.runAllTests();
        break;
    }

    console.log('\n🎉 통합 테스트 완료!');
  } catch (error) {
    console.error('\n💥 통합 테스트 실패:', error.message || error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시에만 main 함수 호출
if (require.main === module) {
  main();
}

export { OrchestrationTester };
