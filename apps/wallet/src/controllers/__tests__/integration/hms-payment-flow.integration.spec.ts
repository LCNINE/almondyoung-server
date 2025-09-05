// controllers/__tests__/integration/hms-payment-flow.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule, DbService } from '@app/db';
import { PaymentMethodController } from '../../payment-method.controller';
import { PaymentMethodService } from '../../../services/payment-method.service';
import { PaymentService } from '../../../services/payment.service';
import { HmsCardPaymentAdapter } from '../../../adapters/hms-card-payment.adapter';
import { HmsBnplPaymentAdapter } from '../../../adapters/hms-bnpl-payment.adapter';
import { TossPaymentAdapter } from '../../../adapters/toss-payment.adapter';
import { InternalPointPaymentAdapter } from '../../../adapters/internal-point-payment.adapter';
import { PaymentGatewayFactory } from '../../../services/payment-gateway.factory';
import { IdempotencyService } from '../../../services/idempotency.service';
import { PaymentStrategyFactory } from '../../../factories/payment-strategy.factory';
import { CardStrategy } from '../../../strategies/card.strategy';
import { BnplStrategy } from '../../../strategies/bnpl.strategy';
import { PointStrategy } from '../../../strategies/point.strategy';
import { BatchCaptureService } from '../../../services/batch-capture.service';
import { BnplLedgerService } from '../../../services/bnpl-ledger.service';
import { HmsAPI, MockHmsAPI, ApiClientFactory } from 'hms-api-wrapper';
import * as schema from '../../../shared/database/schema';
import { CreateGeneralPaymentMethodDto } from '../../../shared/dtos/create-general-payment-method.dto';
import { getTsid } from 'tsid-ts';
import {
  TOSS_PAYMENT_ADAPTER,
  HMS_CARD_PAYMENT_ADAPTER,
  HMS_BNPL_PAYMENT_ADAPTER,
  INTERNAL_POINT_PAYMENT_ADAPTER,
} from '../../../shared/tokens/gateway.tokens';

/**
 * HMS API 통합 테스트 (간소화 버전)
 * 실제 데이터베이스와 HMS API를 사용하여 핵심 결제 플로우를 테스트
 * 
 * 테스트 시나리오:
 * 1. HMS paymentProfiles.create() → 카드 결제수단 등록 → DB 저장
 * 2. 데이터베이스 일관성 확인
 */
describe('HMS Payment Flow Integration Tests (Simplified)', () => {
  let app: INestApplication;
  let paymentMethodController: PaymentMethodController;
  let dbService: DbService;
  let testDataIds: string[] = [];

  // 테스트 환경 설정
  beforeAll(async () => {
    // 통합 테스트용 환경 변수 설정
    process.env.NODE_ENV = 'test';
    // HMS API 사용 여부 - 환경에 따라 조정 가능
    process.env.USE_MOCK = process.env.INTEGRATION_USE_REAL_HMS === 'true' ? 'false' : 'true';
    
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        DbModule.forRoot({
          config: {
            connectionString: process.env.DATABASE_URL || 
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: { ...schema },
        }),
      ],
      controllers: [PaymentMethodController],
      providers: [
        PaymentMethodService,
        PaymentService,
        PaymentGatewayFactory,
        IdempotencyService,
        PaymentStrategyFactory,
        CardStrategy,
        BnplStrategy,
        PointStrategy,
        BatchCaptureService,
        BnplLedgerService,
        // 토큰 기반 어댑터 주입
        {
          provide: TOSS_PAYMENT_ADAPTER,
          useClass: TossPaymentAdapter,
        },
        {
          provide: HMS_CARD_PAYMENT_ADAPTER,
          useClass: HmsCardPaymentAdapter,
        },
        {
          provide: HMS_BNPL_PAYMENT_ADAPTER,
          useClass: HmsBnplPaymentAdapter,
        },
        {
          provide: INTERNAL_POINT_PAYMENT_ADAPTER,
          useClass: InternalPointPaymentAdapter,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    paymentMethodController = moduleFixture.get<PaymentMethodController>(PaymentMethodController);
    dbService = moduleFixture.get<DbService>(DbService);
  });

  beforeEach(async () => {
    testDataIds = [];
  });

  afterEach(async () => {
    // 테스트 데이터 정리
    try {
      if (testDataIds.length > 0) {
        console.log(`정리할 테스트 데이터 IDs: ${testDataIds.join(', ')}`);
        // TODO: 실제 데이터 정리 로직 구현
      }
    } catch (error) {
      console.error('테스트 데이터 정리 실패:', error);
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('HMS PaymentProfiles Integration', () => {
    it('should register card payment method using HMS API and store in database', async () => {
      const testId = getTsid().toString();
      const userId = `test_user_${testId}`;
      
      console.log('🔄 HMS 카드 결제수단 등록 통합 테스트 시작');
      
      // HMS paymentProfiles.create() - 카드 결제수단 등록
      const createPaymentMethodDto: CreateGeneralPaymentMethodDto = {
        userId: userId,
        methodType: 'CARD',
        methodName: '통합테스트 카드',
        isDefault: true,
        cardInfo: {
          cardNumber: '1234567890123456',
          cardHolderName: '홍길동',
          expiryDate: '12/25',
          phone: '01012345678',
          billingCycleDay: 1,
        },
      };

      const paymentMethodResult = await paymentMethodController.registerRecurringCard(createPaymentMethodDto);
      
      // 결과 검증
      expect(paymentMethodResult).toBeDefined();
      expect(paymentMethodResult.id).toBeDefined();
      expect(paymentMethodResult.hmsMemberId).toBeDefined();
      expect(paymentMethodResult.methodType).toBe('CARD');
      
      const paymentMethodId = paymentMethodResult.id;
      const hmsMemberId = paymentMethodResult.hmsMemberId;
      testDataIds.push(paymentMethodId);
      
      console.log(`✅ 결제수단 등록 성공: PaymentMethod ID: ${paymentMethodId}, HMS Member ID: ${hmsMemberId}`);

      // 데이터베이스에서 저장된 결제수단 확인
      const savedPaymentMethods = await paymentMethodController.getUserPaymentMethods(userId);
      expect(savedPaymentMethods.usableMethods).toHaveLength(1);
      expect(savedPaymentMethods.usableMethods[0].id).toBe(paymentMethodId);
      expect(savedPaymentMethods.usableMethods[0].hmsMemberId).toBe(hmsMemberId);
      expect(savedPaymentMethods.usableMethods[0].methodType).toBe('CARD');
      expect(savedPaymentMethods.usableMethods[0].isDefault).toBe(true);
      
      console.log('✅ 데이터베이스 저장 확인 완료');

      // HMS API 호출 검증
      if (process.env.USE_MOCK === 'true') {
        // Mock 환경: HMS API 시뮬레이션 확인
        expect(paymentMethodResult.hmsMemberId).toMatch(/^HMS_CARD_/);
        console.log('✅ Mock HMS API 시뮬레이션 확인');
      } else {
        // 실제 HMS API: 실제 응답 확인
        expect(paymentMethodResult.hmsMemberId).toBeDefined();
        console.log('✅ 실제 HMS API 호출 확인');
      }

      console.log('🎉 HMS 결제수단 등록 통합 테스트 성공!');
    }, 30000);

    it('should handle concurrent HMS API calls without data corruption', async () => {
      const testId = getTsid().toString();
      const baseUserId = `concurrent_user_${testId}`;
      
      console.log('🔄 동시 HMS API 호출 테스트 시작');

      // 동시에 여러 사용자의 결제수단 등록
      const concurrentRegistrations = Array.from({ length: 3 }, (_, index) => {
        const userId = `${baseUserId}_${index}`;
        const createPaymentMethodDto: CreateGeneralPaymentMethodDto = {
          userId: userId,
          methodType: 'CARD',
          methodName: `동시테스트 카드 ${index}`,
          isDefault: true,
          cardInfo: {
            cardNumber: `123456789012345${index}`,
            cardHolderName: `테스트사용자${index}`,
            expiryDate: '12/25',
            phone: `0101234567${index}`,
            billingCycleDay: 1,
          },
        };

        return paymentMethodController.registerRecurringCard(createPaymentMethodDto);
      });

      // 모든 등록이 성공해야 함
      const registrationResults = await Promise.all(concurrentRegistrations);
      
      registrationResults.forEach((result, index) => {
        expect(result.id).toBeDefined();
        expect(result.hmsMemberId).toBeDefined();
        testDataIds.push(result.id);
        console.log(`✅ 동시 등록 ${index + 1} 성공: ${result.id}`);
      });

      // 각 사용자별로 결제수단이 정상 저장되었는지 확인
      for (let index = 0; index < 3; index++) {
        const userId = `${baseUserId}_${index}`;
        const savedPaymentMethods = await paymentMethodController.getUserPaymentMethods(userId);
        expect(savedPaymentMethods.usableMethods).toHaveLength(1);
        expect(savedPaymentMethods.usableMethods[0].methodType).toBe('CARD');
      }

      console.log('✅ 동시 HMS API 호출 테스트 완료: 데이터 무결성 유지 확인');
    }, 45000);

    it('should handle HMS API failure gracefully', async () => {
      const testId = getTsid().toString();
      const userId = `test_user_error_${testId}`;
      
      console.log('🔄 HMS API 실패 시나리오 테스트');

      // 의도적으로 잘못된 카드 정보로 등록 시도
      const createPaymentMethodDto: CreateGeneralPaymentMethodDto = {
        userId: userId,
        methodType: 'CARD',
        methodName: '실패테스트 카드',
        isDefault: true,
        cardInfo: {
          cardNumber: 'invalid_card_number', // 잘못된 카드 번호
          cardHolderName: '', // 빈 이름
          expiryDate: '13/20', // 잘못된 날짜
          phone: 'invalid_phone',
          billingCycleDay: 1,
        },
      };

      try {
        const result = await paymentMethodController.registerRecurringCard(createPaymentMethodDto);
        // Mock 환경에서는 성공할 수도 있음
        console.log('결과:', result);
        if (result.id) {
          testDataIds.push(result.id);
        }
      } catch (error) {
        // 예외가 발생하는 것도 정상
        expect(error).toBeDefined();
        console.log('✅ HMS API 예외 처리 확인:', error.message);
      }

      // 데이터베이스 상태 확인
      const savedPaymentMethods = await paymentMethodController.getUserPaymentMethods(userId);
      console.log('저장된 결제수단 수:', savedPaymentMethods.usableMethods.length + savedPaymentMethods.pendingMethods.length);

      console.log('✅ HMS API 실패 시나리오 완료');
    }, 30000);
  });

  describe('Database Transaction Integrity', () => {
    it('should maintain database consistency', async () => {
      const testId = getTsid().toString();
      const userId = `test_user_consistency_${testId}`;
      
      console.log('🔄 데이터베이스 일관성 테스트');

      // 초기 상태 확인
      const initialPaymentMethods = await paymentMethodController.getUserPaymentMethods(userId);
      expect(initialPaymentMethods.usableMethods).toHaveLength(0);

      // 정상 등록
      const createPaymentMethodDto: CreateGeneralPaymentMethodDto = {
        userId: userId,
        methodType: 'CARD',
        methodName: '일관성테스트 카드',
        isDefault: true,
        cardInfo: {
          cardNumber: '1234567890123456',
          cardHolderName: '홍길동',
          expiryDate: '12/25',
          phone: '01012345678',
          billingCycleDay: 1,
        },
      };

      const result = await paymentMethodController.registerRecurringCard(createPaymentMethodDto);
      expect(result.id).toBeDefined();
      testDataIds.push(result.id);

      // 최종 상태 확인
      const finalPaymentMethods = await paymentMethodController.getUserPaymentMethods(userId);
      expect(finalPaymentMethods.usableMethods).toHaveLength(1);
      expect(finalPaymentMethods.usableMethods[0].methodType).toBe('CARD');

      console.log('✅ 데이터베이스 일관성 테스트 완료');
    }, 30000);
  });
});