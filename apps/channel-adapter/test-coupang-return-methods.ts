/**
 * 쿠팡 반품 관련 메서드 테스트
 *
 * 새로 구현된 메서드들을 테스트합니다:
 * - executeReturnProcessAlreadyShipped
 * - executeReturnRegisterCollectionInvoice
 */

import * as dotenv from 'dotenv';
import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CoupangAdapter } from './src/services/adapters/coupang.adapter';
import { CoupangApiService } from './src/services/apis/coupang.api.service';
import { WmsApiService } from './src/services/apis/wms.api.service';
import { DlqMonitoringService } from './src/services/dlq-monitoring.service';

// 환경변수 로드
dotenv.config();

class CoupangReturnMethodsTester {
  private readonly logger = new Logger('CoupangReturnMethodsTester');
  private readonly adapter: CoupangAdapter;

  constructor() {
    const httpService = new HttpService();
    const coupangApiService = new CoupangApiService(httpService);

    // ConfigService 생성 (환경변수 기반)
    const configService = new ConfigService();

    // Mock EventPublisher 생성
    const mockEventPublisher = {
      publishEvent: async () => {},
    } as any;

    // DlqMonitoringService 생성
    const dlqMonitoring = new DlqMonitoringService(
      configService,
      mockEventPublisher,
    );

    // WmsApiService는 3개의 인수가 필요합니다
    const wmsApiService = new WmsApiService(
      httpService,
      configService,
      dlqMonitoring,
    );

    this.adapter = new CoupangAdapter(coupangApiService, wmsApiService);

    this.logger.log('🏗️ 쿠팡 반품 메서드 테스터 초기화 완료');
  }

  /**
   * 테스트 1: 이미출고처리 (return.process_already_shipped)
   */
  async testProcessAlreadyShipped(): Promise<void> {
    this.logger.log('\n========================================');
    this.logger.log('🧪 테스트 1: 이미출고처리');
    this.logger.log('========================================\n');

    try {
      const command = {
        type: 'return.process_already_shipped' as const,
        claimId: '12345678', // 테스트용 receiptId
        tracking: {
          companyCode: 'CJ',
          number: '123456789012',
        },
      };

      this.logger.log('📤 명령 전송:', JSON.stringify(command, null, 2));

      // @ts-ignore - 테스트용 명령 타입
      const result = await this.adapter.executeCommand(command);

      this.logger.log('\n📥 실행 결과:');
      this.logger.log(JSON.stringify(result, null, 2));

      if (result.success) {
        this.logger.log('\n✅ 테스트 성공: 이미출고처리 완료');
      } else {
        this.logger.warn('\n⚠️ 테스트 실패:', result.errors);
      }
    } catch (error) {
      this.logger.error('\n❌ 테스트 오류:', error.message);
      throw error;
    }
  }

  /**
   * 테스트 2: 반품 회수송장 등록 (return.register_collection_invoice - RETURN)
   */
  async testRegisterReturnInvoice(): Promise<void> {
    this.logger.log('\n========================================');
    this.logger.log('🧪 테스트 2: 반품 회수송장 등록');
    this.logger.log('========================================\n');

    try {
      const command = {
        type: 'return.register_collection_invoice' as const,
        claimId: '87654321', // 테스트용 receiptId
        collectionType: 'RETURN' as const,
        tracking: {
          companyCode: 'HANJIN',
          number: '987654321098',
        },
      };

      this.logger.log('📤 명령 전송:', JSON.stringify(command, null, 2));

      // @ts-ignore - 테스트용 명령 타입
      const result = await this.adapter.executeCommand(command);

      this.logger.log('\n📥 실행 결과:');
      this.logger.log(JSON.stringify(result, null, 2));

      if (result.success) {
        this.logger.log('\n✅ 테스트 성공: 반품 회수송장 등록 완료');
      } else {
        this.logger.warn('\n⚠️ 테스트 실패:', result.errors);
      }
    } catch (error) {
      this.logger.error('\n❌ 테스트 오류:', error.message);
      throw error;
    }
  }

  /**
   * 테스트 3: 교환 회수송장 등록 (return.register_collection_invoice - EXCHANGE)
   */
  async testRegisterExchangeInvoice(): Promise<void> {
    this.logger.log('\n========================================');
    this.logger.log('🧪 테스트 3: 교환 회수송장 등록');
    this.logger.log('========================================\n');

    try {
      const command = {
        type: 'return.register_collection_invoice' as const,
        claimId: '11223344', // 테스트용 receiptId
        collectionType: 'EXCHANGE' as const,
        tracking: {
          companyCode: 'LOTTE',
          number: '555666777888',
        },
      };

      this.logger.log('📤 명령 전송:', JSON.stringify(command, null, 2));

      // @ts-ignore - 테스트용 명령 타입
      const result = await this.adapter.executeCommand(command);

      this.logger.log('\n📥 실행 결과:');
      this.logger.log(JSON.stringify(result, null, 2));

      if (result.success) {
        this.logger.log('\n✅ 테스트 성공: 교환 회수송장 등록 완료');
      } else {
        this.logger.warn('\n⚠️ 테스트 실패:', result.errors);
      }
    } catch (error) {
      this.logger.error('\n❌ 테스트 오류:', error.message);
      throw error;
    }
  }

  /**
   * 모든 테스트 실행
   */
  async runAllTests(): Promise<void> {
    this.logger.log('\n🚀 쿠팡 반품 메서드 테스트 시작\n');

    try {
      // 테스트 1: 이미출고처리
      await this.testProcessAlreadyShipped();

      // 잠시 대기 (API 호출 제한 대응)
      await this.delay(1000);

      // 테스트 2: 반품 회수송장 등록
      await this.testRegisterReturnInvoice();

      // 잠시 대기
      await this.delay(1000);

      // 테스트 3: 교환 회수송장 등록
      await this.testRegisterExchangeInvoice();

      this.logger.log('\n========================================');
      this.logger.log('🎉 모든 테스트 완료!');
      this.logger.log('========================================\n');
    } catch (error) {
      this.logger.error('\n💥 테스트 실행 중 오류 발생:', error.message);
      throw error;
    }
  }

  /**
   * 지연 유틸리티
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 테스트 실행
async function main() {
  const tester = new CoupangReturnMethodsTester();

  try {
    await tester.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error('테스트 실패:', error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  main();
}

export { CoupangReturnMethodsTester };
