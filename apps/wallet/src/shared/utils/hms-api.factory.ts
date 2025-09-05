// shared/utils/hms-api.factory.ts
import { HmsAPI, MockHmsAPI, ApiClientFactory } from 'hms-api-wrapper';
import { Logger } from '@nestjs/common';

/**
 * HMS API Factory - 서비스별 환경 분리
 *
 * 🎯 전략:
 * - BNPL: Mock 서버 (Test 서버에서 수동 승인 필요)
 * - Card: Test 서버 (실시간 지원)
 */
export class HmsApiFactory {
  private static readonly logger = new Logger(HmsApiFactory.name);

  /**
   * BNPL용 HMS API - 항상 Mock 사용
   */
  static createForBnpl(): MockHmsAPI {
    // BNPL은 항상 Mock 서버 사용 (수동 승인 필요)
    const originalUseMock = process.env.USE_MOCK;
    process.env.USE_MOCK = 'true';

    const mockApi = ApiClientFactory.createFromEnv() as MockHmsAPI;

    // 원래 설정 복원
    if (originalUseMock !== undefined) {
      process.env.USE_MOCK = originalUseMock;
    } else {
      delete process.env.USE_MOCK;
    }

    this.logger.log('🔧 BNPL용 HMS Mock API 생성');
    return mockApi;
  }

  /**
   * 신용카드용 HMS API - 임시로 Mock 사용 (테스트용)
   */
  static createForCard(): HmsAPI | MockHmsAPI {
    // 임시로 Mock API 사용 (테스트를 위해)
    this.logger.log('🧪 테스트용: 신용카드도 Mock API 사용');
    return this.createForBnpl();

    // // 신용카드는 Test 서버 우선 사용 (실시간 지원)
    // const hasCredentials = process.env.SW_KEY && process.env.CUST_KEY;

    // if (hasCredentials) {
    //   // Test 서버 사용
    //   const originalUseMock = process.env.USE_MOCK;
    //   process.env.USE_MOCK = 'false';

    //   const testApi = ApiClientFactory.createFromEnv() as HmsAPI;

    //   // 원래 설정 복원
    //   if (originalUseMock !== undefined) {
    //     process.env.USE_MOCK = originalUseMock;
    //   }

    //   this.logger.log('🎯 신용카드용 HMS Test API 생성');
    //   return testApi;
    // } else {
    //   // 자격증명 없으면 Mock으로 폴백
    //   this.logger.warn('SW_KEY/CUST_KEY 없음: 신용카드도 Mock으로 폴백');
    //   return this.createForBnpl();
    // }
  }

  /**
   * 통합 API (기존 호환성용)
   */
  static createFromEnv(): HmsAPI | MockHmsAPI {
    return ApiClientFactory.createFromEnv();
  }
}
