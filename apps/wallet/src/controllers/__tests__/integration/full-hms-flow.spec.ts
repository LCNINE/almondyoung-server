// Full HMS Flow Integration Test
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from '../../../services/payment.service';
import { PaymentStrategyFactory } from '../../../factories/payment-strategy.factory';
import { CardStrategy } from '../../../strategies/card.strategy';
import { HmsCardPaymentAdapter } from '../../../adapters/hms-card-payment.adapter';
import { IdempotencyService } from '../../../services/idempotency.service';
import { BatchCaptureService } from '../../../services/batch-capture.service';
import { BnplLedgerService } from '../../../services/bnpl-ledger.service';
import { DbModule, DbService } from '@app/db';
import * as schema from '../../../shared/database/schema';
import { getTsid } from 'tsid-ts';
import {
  HMS_CARD_PAYMENT_ADAPTER,
} from '../../../shared/tokens/gateway.tokens';

describe('Full HMS Flow Integration Test', () => {
  let paymentService: PaymentService;
  let dbService: DbService;

  beforeAll(async () => {
    // 환경변수 설정 - 실제 HMS API 사용
    process.env.SW_KEY = '4LjFflzr6z4YSknp';
    process.env.CUST_KEY = 'BT2z4D5DUm7cE5tl';
    process.env.USE_MOCK = 'false'; // 실제 HMS API 사용
    process.env.NODE_ENV = 'test';

    const module: TestingModule = await Test.createTestingModule({
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
      providers: [
        PaymentService,
        PaymentStrategyFactory,
        CardStrategy,
        IdempotencyService,
        BatchCaptureService,
        BnplLedgerService,
        {
          provide: HMS_CARD_PAYMENT_ADAPTER,
          useClass: HmsCardPaymentAdapter,
        },
      ],
    }).compile();

    paymentService = module.get<PaymentService>(PaymentService);
    dbService = module.get<DbService>(DbService);
  });

  it('should register card payment method with real HMS API', async () => {
    const testId = getTsid().toString();
    
    // HMS API 실제 요청 형식에 맞는 데이터
    const request = {
      userId: `user_${testId}`,
      memberName: '홍길동',
      phone: '01012345678',
      paymentNumber: '1234567890123456',
      payerName: '홍길동',
      payerNumber: '1234567890123456',
      validYear: '25',
      validMonth: '12',
      billingCycleDay: 1,
    };

    console.log('PaymentService 호출 시작...');
    console.log('요청 데이터:', JSON.stringify(request, null, 2));

    try {
      const result = await paymentService.registerPaymentMethod(
        'CARD',
        request,
        undefined,
        'RECURRING'
      );

      console.log('PaymentService 결과:', JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.hmsMemberId).toBeDefined();
      
      if (result.success) {
        console.log(`✅ HMS 회원 등록 성공: ${result.hmsMemberId}`);
      }

    } catch (error) {
      console.error('PaymentService 에러:', error);
      
      // 에러 내용 분석
      if (error.message.includes('HMS')) {
        console.log('HMS API 관련 에러 발생');
      }
      if (error.message.includes('paymentProfiles')) {
        console.log('HMS paymentProfiles API 호출 실패');
      }
      if (error.message.includes('swKey') || error.message.includes('custKey')) {
        console.log('HMS API 인증 실패');
      }
      
      // 실제 HMS API 에러인지 확인하기 위해 에러를 다시 던짐
      throw error;
    }
  }, 30000);

  it('should handle HMS API error gracefully', async () => {
    const testId = getTsid().toString();
    
    // 의도적으로 잘못된 데이터로 HMS API 에러 유발
    const invalidRequest = {
      userId: `user_${testId}`,
      memberName: '', // 빈 이름
      phone: 'invalid', // 잘못된 전화번호
      paymentNumber: '123', // 너무 짧은 카드번호
      payerName: '',
      payerNumber: '123',
      validYear: '99', // 잘못된 연도
      validMonth: '13', // 잘못된 월
      billingCycleDay: 1,
    };

    console.log('잘못된 데이터로 HMS API 호출...');

    try {
      const result = await paymentService.registerPaymentMethod(
        'CARD',
        invalidRequest,
        undefined,
        'RECURRING'
      );

      // 실패해야 정상
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      
      console.log('예상된 실패:', result.error);

    } catch (error) {
      console.log('예상된 에러 발생:', error.message);
      expect(error).toBeDefined();
    }
  }, 15000);

  it('should test HMS API connection directly', async () => {
    const testId = getTsid().toString();
    
    // HmsCardPaymentAdapter 직접 테스트
    const adapter = new HmsCardPaymentAdapter();
    
    const request = {
      userId: `user_${testId}`,
      memberName: '홍길동',
      phone: '01012345678',
      paymentNumber: '1234567890123456',
      payerName: '홍길동',
      payerNumber: '1234567890123456',
      validYear: '25',
      validMonth: '12',
      billingCycleDay: 1,
    };

    console.log('HMS Adapter 직접 호출...');

    try {
      const result = await adapter.registerRecurringMember(request);
      
      console.log('HMS Adapter 결과:', JSON.stringify(result, null, 2));
      
      expect(result).toBeDefined();
      
      if (result.success) {
        console.log(`✅ HMS Adapter 성공: ${result.hmsMemberId}`);
      } else {
        console.log(`❌ HMS Adapter 실패: ${result.error}`);
      }

    } catch (error) {
      console.error('HMS Adapter 에러:', error);
      
      // HMS API 연결 문제인지 확인
      if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
        console.log('HMS API 서버 연결 실패');
      } else if (error.message.includes('401') || error.message.includes('403')) {
        console.log('HMS API 인증 실패');
      } else {
        console.log('기타 HMS API 에러');
      }
      
      throw error;
    }
  }, 20000);
});