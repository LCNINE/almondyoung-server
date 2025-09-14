// apps/wallet/src/services/__tests__/test-module.factory.ts

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DbModule, DbService } from '@app/db';

// 실제 서비스들 import (단일 책임 출처)
import { PaymentService } from '../payment.service';
import { PaymentProfileV2Service } from '../payment-profile-v2.service';
import { PaymentProviderFactory } from '../../providers/payment-provider.factory';
import { HmsCardProvider } from '../../providers/hms-card.provider';
import { HmsBnplProvider } from '../../providers/hms-bnpl.provider';
import { TossProvider } from '../../providers/toss.provider';
import {
  PaymentOrchestratorService,
  PaymentValidatorService,
  PaymentExecutorService,
} from '../payment';
import { PaymentPayloadResolverService } from '../payment/payment-payload-resolver.service';

// 실제 DB 스키마 import
import * as schema from '../../shared/database/schema';

/**
 * 테스트 모듈 팩토리 - 의존성 실수 방지
 *
 * 테스트 코드 전문가의 3가지 원칙:
 * 1. 단일 출처 원칙: 실제 앱 모듈과 동일한 의존성 구조
 * 2. 완전성 검증: 모든 필수 의존성 자동 포함
 * 3. 재사용성: 모든 테스트에서 동일한 설정 사용
 */

/**
 * 완전한 결제 시스템 테스트 모듈 생성
 *
 * 특징:
 * - PaymentProviderFactory의 모든 의존성 자동 포함
 * - 🔥 실제 DB 연결 사용 (Mock 금지!)
 * - 실제 Provider들 모두 포함 (HMS Card, HMS BNPL, Toss)
 * - 실제 환경과 동일한 설정
 */
export class PaymentTestModuleFactory {
  /**
   * 실제 DB를 사용하는 테스트 모듈 생성
   *
   * 🔥 Mock 금지! 실제 DB만 사용!
   *
   * @returns 실제 DB 연결을 포함한 완전한 테스트 모듈
   */
  static async createWithRealDb(): Promise<TestingModule> {
    return await Test.createTestingModule({
      imports: [
        // 실제 환경과 동일한 설정
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        // 🔥 실제 DB 연결 사용
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: { ...schema },
        }),
      ],
      providers: [
        // === 핵심 서비스들 ===
        PaymentService,
        PaymentProfileV2Service,

        // === Provider Factory와 모든 의존성 ===
        PaymentProviderFactory,
        HmsCardProvider, // ✅ 필수: PaymentProviderFactory 의존성
        HmsBnplProvider, // ✅ 필수: PaymentProviderFactory 의존성
        TossProvider, // ✅ 필수: PaymentProviderFactory 의존성

        // === 결제 비즈니스 로직 서비스들 ===
        PaymentOrchestratorService,
        PaymentValidatorService,
        PaymentExecutorService,
        PaymentPayloadResolverService, // ✅ 필수: PaymentExecutorService 의존성

        // 🔥 실제 DbService 사용 (Mock 없음!)
      ],
    }).compile();
  }

  /**
   * HMS 카드 전용 실제 DB 테스트 모듈
   * 🔥 실제 DB 사용!
   */
  static async createForHmsCard(): Promise<TestingModule> {
    return this.createWithRealDb();
  }

  /**
   * E2E 테스트용 실제 DB 모듈
   * 🔥 실제 DB 사용!
   */
  static async createForE2E(): Promise<TestingModule> {
    return this.createWithRealDb();
  }
}

// 🔥 모든 Mock 함수 제거!
// 실제 DB만 사용합니다!

/**
 * 의존성 검증 헬퍼
 * 테스트 모듈이 올바르게 구성되었는지 검증
 */
export class DependencyValidator {
  /**
   * PaymentProviderFactory 의존성 완전성 검증
   */
  static validatePaymentProviderFactory(module: TestingModule): void {
    const factory = module.get<PaymentProviderFactory>(PaymentProviderFactory);
    const hmsCard = module.get<HmsCardProvider>(HmsCardProvider);
    const hmsBnpl = module.get<HmsBnplProvider>(HmsBnplProvider);
    const toss = module.get<TossProvider>(TossProvider);

    expect(factory).toBeDefined();
    expect(hmsCard).toBeDefined();
    expect(hmsBnpl).toBeDefined();
    expect(toss).toBeDefined();

    // Provider Factory 내부 의존성 검증
    expect(factory['hmsCardProvider']).toBe(hmsCard);
    expect(factory['hmsBnplProvider']).toBe(hmsBnpl);
    expect(factory['tossProvider']).toBe(toss);
  }

  /**
   * PaymentService 의존성 완전성 검증
   */
  static validatePaymentService(module: TestingModule): void {
    const paymentService = module.get<PaymentService>(PaymentService);
    const providerFactory = module.get<PaymentProviderFactory>(
      PaymentProviderFactory,
    );
    const orchestrator = module.get<PaymentOrchestratorService>(
      PaymentOrchestratorService,
    );
    const validator = module.get<PaymentValidatorService>(
      PaymentValidatorService,
    );
    const executor = module.get<PaymentExecutorService>(PaymentExecutorService);

    expect(paymentService).toBeDefined();
    expect(providerFactory).toBeDefined();
    expect(orchestrator).toBeDefined();
    expect(validator).toBeDefined();
    expect(executor).toBeDefined();

    // PaymentService 내부 의존성 검증
    expect(paymentService['providerFactory']).toBe(providerFactory);
    expect(paymentService['paymentOrchestrator']).toBe(orchestrator);
    expect(paymentService['paymentValidator']).toBe(validator);
    expect(paymentService['paymentExecutor']).toBe(executor);
  }

  /**
   * 전체 모듈 의존성 검증
   */
  static validateCompleteModule(module: TestingModule): void {
    this.validatePaymentProviderFactory(module);
    this.validatePaymentService(module);

    // 추가 서비스들 검증
    const profileService = module.get<PaymentProfileV2Service>(
      PaymentProfileV2Service,
    );
    const dbService = module.get<DbService>(DbService);

    expect(profileService).toBeDefined();
    expect(dbService).toBeDefined();
  }
}

/**
 * 테스트 환경 헬퍼
 */
export class TestEnvironmentHelper {
  /**
   * HMS 환경변수 존재 여부 확인
   */
  static hasHmsCredentials(): boolean {
    return !!(process.env.SW_KEY && process.env.CUST_KEY);
  }

  /**
   * 테스트 서버 모드 설정
   */
  static setupTestMode(): void {
    process.env.NODE_ENV = 'test';
  }

  /**
   * 테스트용 HMS 환경변수 설정 (개발용)
   */
  static setupTestCredentials(): void {
    if (!process.env.SW_KEY) {
      process.env.SW_KEY = '4LjFflzr6z4YSknp'; // 테스트용
    }
    if (!process.env.CUST_KEY) {
      process.env.CUST_KEY = 'BT2z4D5DUm7cE5tl'; // 테스트용
    }
  }
}
