// controllers/__tests__/shared/test-api-client-factory.ts
import { HmsAPI, MockHmsAPI, ApiClientFactory } from 'hms-api-wrapper';
import { Logger } from '@nestjs/common';

/**
 * 테스트 시나리오 타입
 */
export type TestScenario = 'success' | 'error' | 'timeout' | 'network_error' | 'auth_error';

/**
 * 테스트 API 클라이언트 설정
 */
export interface TestApiClientConfig {
  useMock: boolean;
  paymentMethod: 'CARD' | 'BNPL' | 'POINT';
  testScenario?: TestScenario;
}

/**
 * 테스트용 HMS API 클라이언트 팩토리
 * hms-api-wrapper의 기존 Mock/Real 전환 기능을 활용하여 테스트 환경을 설정
 */
export class TestApiClientFactory {
  private static readonly logger = new Logger(TestApiClientFactory.name);

  /**
   * 테스트용 HMS API 클라이언트 생성
   * hms-api-wrapper의 ApiClientFactory를 활용하여 환경변수 기반으로 Mock/Real 전환
   */
  static createForTest(config: TestApiClientConfig): HmsAPI | MockHmsAPI {
    const { useMock, paymentMethod } = config;

    // 환경변수 백업
    const originalEnv = this.backupEnvironment();
    
    try {
      // 테스트 환경 설정
      this.setupTestEnvironment(useMock, paymentMethod);
      
      // hms-api-wrapper의 기존 팩토리 사용
      const client = ApiClientFactory.createFromEnv();
      
      this.logger.log(`🔧 HMS API 클라이언트 생성: ${useMock ? 'Mock' : 'Real'} (${paymentMethod})`);
      return client;
    } finally {
      // 환경변수 복원
      this.restoreEnvironment(originalEnv);
    }
  }

  /**
   * BNPL용 클라이언트 생성 (항상 Mock 사용)
   */
  static createForBnpl(): MockHmsAPI {
    return this.createForTest({
      useMock: true,
      paymentMethod: 'BNPL',
      testScenario: 'success',
    }) as MockHmsAPI;
  }

  /**
   * Card용 클라이언트 생성 (환경에 따라 Mock/Real 전환)
   */
  static createForCard(useMock: boolean = false): HmsAPI | MockHmsAPI {
    return this.createForTest({
      useMock,
      paymentMethod: 'CARD',
      testScenario: 'success',
    });
  }

  /**
   * 환경변수 백업
   */
  private static backupEnvironment(): Record<string, string | undefined> {
    return {
      USE_MOCK: process.env.USE_MOCK,
      NODE_ENV: process.env.NODE_ENV,
      SW_KEY: process.env.SW_KEY,
      CUST_KEY: process.env.CUST_KEY,
      MOCK_SERVER_URL: process.env.MOCK_SERVER_URL,
    };
  }

  /**
   * 환경변수 복원
   */
  private static restoreEnvironment(backup: Record<string, string | undefined>): void {
    Object.entries(backup).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }

  /**
   * 테스트 환경 설정
   */
  private static setupTestEnvironment(useMock: boolean, paymentMethod: string): void {
    process.env.NODE_ENV = 'test';
    process.env.USE_MOCK = useMock.toString();
    
    if (paymentMethod === 'BNPL') {
      // BNPL은 항상 Mock 사용
      process.env.USE_MOCK = 'true';
    }
    
    if (!useMock && paymentMethod === 'CARD') {
      // Card 테스트 서버용 자격증명 설정
      process.env.SW_KEY = process.env.SW_KEY || 'test_sw_key';
      process.env.CUST_KEY = process.env.CUST_KEY || 'test_cust_key';
    }
    
    // Mock 서버 URL 설정
    process.env.MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || 'http://localhost:3005';
  }

  /**
   * 환경 기반 클라이언트 생성 (기존 호환성)
   */
  static createFromEnvironment(paymentMethod: 'CARD' | 'BNPL' = 'CARD'): HmsAPI | MockHmsAPI {
    const useMock = process.env.USE_MOCK === 'true';
    return this.createForTest({
      useMock,
      paymentMethod,
      testScenario: 'success',
    });
  }

  /**
   * 기본 환경변수로 클라이언트 생성 (hms-api-wrapper 직접 사용)
   */
  static createDefault(): HmsAPI | MockHmsAPI {
    return ApiClientFactory.createFromEnv();
  }
}