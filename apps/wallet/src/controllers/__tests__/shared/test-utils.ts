// controllers/__tests__/shared/test-utils.ts
import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@app/db';
import { PaymentService } from '../../../services/payment.service';
import { PaymentMethodService } from '../../../services/payment-method.service';
import { PaymentSessionService } from '../../../services/payment-session.service';
import { RefundService } from '../../../services/refund.service';
import { SettlementService } from '../../../services/settlement.service';
import { PaymentStrategyFactory } from '../../../factories/payment-strategy.factory';
import { IdempotencyService } from '../../../services/idempotency.service';
import { BatchCaptureService } from '../../../services/batch-capture.service';

/**
 * 테스트 환경 설정 유틸리티
 */
export class TestEnvironmentUtils {
  /**
   * 환경변수 백업 및 복원을 위한 헬퍼
   */
  static backupEnvironment(): Record<string, string | undefined> {
    return {
      USE_MOCK: process.env.USE_MOCK,
      NODE_ENV: process.env.NODE_ENV,
      SW_KEY: process.env.SW_KEY,
      CUST_KEY: process.env.CUST_KEY,
      MOCK_SERVER_URL: process.env.MOCK_SERVER_URL,
    };
  }

  static restoreEnvironment(backup: Record<string, string | undefined>): void {
    Object.entries(backup).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }

  /**
   * 테스트용 환경변수 설정
   */
  static setupTestEnvironment(config: {
    useMock?: boolean;
    hasCredentials?: boolean;
    mockServerUrl?: string;
  } = {}): void {
    const {
      useMock = true,
      hasCredentials = false,
      mockServerUrl = 'http://localhost:3005',
    } = config;

    process.env.NODE_ENV = 'test';
    process.env.USE_MOCK = useMock.toString();
    process.env.MOCK_SERVER_URL = mockServerUrl;

    if (hasCredentials) {
      process.env.SW_KEY = 'test_sw_key';
      process.env.CUST_KEY = 'test_cust_key';
    } else {
      delete process.env.SW_KEY;
      delete process.env.CUST_KEY;
    }
  }
}

/**
 * 공통 모킹 유틸리티
 */
export class MockingUtils {
  /**
   * DbService 모킹
   */
  static createMockDbService(): jest.Mocked<DbService<any>> {
    const mockTransaction = jest.fn();
    const mockInsert = jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    });
    const mockUpdate = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });

    return {
      db: {
        transaction: mockTransaction,
        insert: mockInsert,
        update: mockUpdate,
        select: mockSelect,
      },
    } as any;
  }

  /**
   * PaymentService 모킹
   */
  static createMockPaymentService(): jest.Mocked<PaymentService> {
    return {
      processPayment: jest.fn(),
      registerPaymentMethod: jest.fn(),
      refundPayment: jest.fn(),
      batchCapture: jest.fn(),
      getMemberStatus: jest.fn(),
      activateAccount: jest.fn(),
      deactivateAccount: jest.fn(),
      submitConsent: jest.fn(),
      createBnplSettlementBatch: jest.fn(),
      getSettlementBatchStatus: jest.fn(),
      getPendingSettlementBatches: jest.fn(),
    } as any;
  }

  /**
   * PaymentMethodService 모킹
   */
  static createMockPaymentMethodService(): jest.Mocked<PaymentMethodService> {
    return {
      get: jest.fn(),
      getUserMethodsWithStatus: jest.fn(),
      setAsDefault: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
    } as any;
  }

  /**
   * PaymentSessionService 모킹
   */
  static createMockPaymentSessionService(): jest.Mocked<PaymentSessionService> {
    return {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
      validateSession: jest.fn(),
      generateCheckoutUrl: jest.fn(),
    } as any;
  }

  /**
   * RefundService 모킹
   */
  static createMockRefundService(): jest.Mocked<RefundService> {
    return {
      processRefund: jest.fn(),
      getRefundStatus: jest.fn(),
      listRefunds: jest.fn(),
      cancelRefund: jest.fn(),
    } as any;
  }

  /**
   * SettlementService 모킹
   */
  static createMockSettlementService(): jest.Mocked<SettlementService> {
    return {
      runMonthlySettlement: jest.fn(),
      getBatchStatus: jest.fn(),
      retryFailedBatch: jest.fn(),
      listSettlementBatches: jest.fn(),
    } as any;
  }

  /**
   * PaymentStrategyFactory 모킹
   */
  static createMockPaymentStrategyFactory(): jest.Mocked<PaymentStrategyFactory> {
    return {
      getStrategy: jest.fn(),
      getBatchProcessingStrategy: jest.fn(),
    } as any;
  }

  /**
   * IdempotencyService 모킹
   */
  static createMockIdempotencyService(): jest.Mocked<IdempotencyService> {
    return {
      checkOrCreate: jest.fn(),
      complete: jest.fn(),
      get: jest.fn(),
      cleanup: jest.fn(),
    } as any;
  }

  /**
   * BatchCaptureService 모킹
   */
  static createMockBatchCaptureService(): jest.Mocked<BatchCaptureService> {
    return {
      createAndExecuteBnplSettlementBatch: jest.fn(),
      getSettlementBatchStatus: jest.fn(),
      getPendingSettlementBatches: jest.fn(),
      retryFailedBatch: jest.fn(),
    } as any;
  }
}

/**
 * 테스트 모듈 빌더
 */
export class TestModuleBuilder {
  /**
   * 컨트롤러 테스트용 기본 모듈 생성
   */
  static async createControllerTestModule(
    controller: any,
    customProviders: any[] = [],
  ): Promise<TestingModule> {
    const defaultProviders = [
      { provide: DbService, useValue: MockingUtils.createMockDbService() },
      { provide: PaymentService, useValue: MockingUtils.createMockPaymentService() },
      { provide: PaymentMethodService, useValue: MockingUtils.createMockPaymentMethodService() },
      { provide: PaymentSessionService, useValue: MockingUtils.createMockPaymentSessionService() },
      { provide: RefundService, useValue: MockingUtils.createMockRefundService() },
      { provide: SettlementService, useValue: MockingUtils.createMockSettlementService() },
      { provide: PaymentStrategyFactory, useValue: MockingUtils.createMockPaymentStrategyFactory() },
      { provide: IdempotencyService, useValue: MockingUtils.createMockIdempotencyService() },
      { provide: BatchCaptureService, useValue: MockingUtils.createMockBatchCaptureService() },
    ];

    // 커스텀 프로바이더가 있으면 기본값을 덮어씀
    const providers = [...defaultProviders];
    customProviders.forEach(customProvider => {
      const existingIndex = providers.findIndex(p => p.provide === customProvider.provide);
      if (existingIndex >= 0) {
        providers[existingIndex] = customProvider;
      } else {
        providers.push(customProvider);
      }
    });

    return await Test.createTestingModule({
      controllers: [controller],
      providers,
    }).compile();
  }
}

/**
 * 테스트 실행 헬퍼
 */
export class TestExecutionUtils {
  /**
   * 비동기 에러 테스트 헬퍼
   */
  static async expectAsyncError(
    asyncFn: () => Promise<any>,
    expectedError: string | RegExp,
  ): Promise<void> {
    try {
      await asyncFn();
      throw new Error('Expected function to throw an error');
    } catch (error) {
      if (typeof expectedError === 'string') {
        expect(error.message).toContain(expectedError);
      } else {
        expect(error.message).toMatch(expectedError);
      }
    }
  }

  /**
   * HTTP 예외 테스트 헬퍼
   */
  static expectHttpException(
    error: any,
    expectedStatus: number,
    expectedMessage?: string | RegExp,
  ): void {
    expect(error.getStatus()).toBe(expectedStatus);
    if (expectedMessage) {
      if (typeof expectedMessage === 'string') {
        expect(error.message).toContain(expectedMessage);
      } else {
        expect(error.message).toMatch(expectedMessage);
      }
    }
  }

  /**
   * 멱등성 키 생성
   */
  static generateIdempotencyKey(prefix = 'test'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 테스트 타임아웃 설정
   */
  static setTestTimeout(ms: number = 10000): void {
    jest.setTimeout(ms);
  }
}