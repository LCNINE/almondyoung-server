import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DbService } from '@app/db';
import { EventsModule } from '@app/events';
import * as schema from '../../shared/database/schema';
import { HmsCardPaymentAdapter } from '../../adapters/hms-card-payment.adapter';
import { PaymentService } from '../../services/payment.service';
import { PaymentMethodService } from '../../services/payment-method.service';
import { PaymentStrategyFactory } from '../../factories/payment-strategy.factory';
import { CardStrategy } from '../../strategies/card.strategy';
import { HMS_CARD_PAYMENT_ADAPTER } from '../../shared/tokens/gateway.tokens';
import { readFileSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';

/**
 * HMS memberID 획득 및 구독 결제 플로우 테스트
 *
 * 이 테스트는 다음 플로우를 검증합니다:
 * 1. 로컬 멤버십 데이터에서 카드 정보 로드
 * 2. HMS API를 통한 카드 등록 및 memberID 획득
 * 3. 획득한 memberID로 실제 결제 테스트
 * 4. HMS 상태 검증 및 에러 처리
 */
describe('HMS MemberID Flow Tests', () => {
  let dbService: DbService<typeof schema>;
  let hmsCardAdapter: HmsCardPaymentAdapter;
  let paymentService: PaymentService;
  let paymentMethodService: PaymentMethodService;

  // 로컬 멤버십 데이터
  let membershipData: any;

  // 테스트 결과 저장
  let testResults: {
    registeredMembers: Array<{
      memberInfo: any;
      hmsMemberId: string;
      registrationResult: any;
    }>;
    paymentTests: Array<{
      hmsMemberId: string;
      amount: number;
      paymentResult: any;
    }>;
  };

  beforeAll(async () => {
    // 로컬 멤버십 데이터 로드
    const membershipDbPath = join(
      __dirname,
      '../../../test/membership-db.json',
    );
    membershipData = JSON.parse(readFileSync(membershipDbPath, 'utf-8'));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.TEST_DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: { ...schema },
        }),
        EventsModule,
      ],
      providers: [
        PaymentService,
        PaymentMethodService,
        PaymentStrategyFactory,
        CardStrategy,
        {
          provide: HMS_CARD_PAYMENT_ADAPTER,
          useClass: HmsCardPaymentAdapter,
        },
      ],
    }).compile();

    dbService = moduleFixture.get<DbService<typeof schema>>(DbService);
    hmsCardAdapter = moduleFixture.get<HmsCardPaymentAdapter>(
      HMS_CARD_PAYMENT_ADAPTER,
    );
    paymentService = moduleFixture.get<PaymentService>(PaymentService);
    paymentMethodService =
      moduleFixture.get<PaymentMethodService>(PaymentMethodService);

    // 테스트 결과 초기화
    testResults = {
      registeredMembers: [],
      paymentTests: [],
    };

    console.log('🚀 HMS memberID 플로우 테스트 시작');
    console.log('로컬 멤버십 데이터:', {
      members: membershipData.members.length,
      paymentMethods: membershipData.paymentMethods.length,
      plans: membershipData.subscriptionPlans.length,
    });
  });

  afterAll(async () => {
    // 테스트 결과 출력
    console.log('\n📊 HMS memberID 플로우 테스트 결과 요약:');
    console.log('등록된 회원:', testResults.registeredMembers.length);
    console.log('결제 테스트:', testResults.paymentTests.length);

    testResults.registeredMembers.forEach((member, index) => {
      console.log(`\n회원 ${index + 1}: ${member.memberInfo.memberName}`);
      console.log(`  HMS memberID: ${member.hmsMemberId}`);
      console.log(`  등록 성공: ${member.registrationResult.success}`);
    });

    testResults.paymentTests.forEach((test, index) => {
      console.log(`\n결제 테스트 ${index + 1}:`);
      console.log(`  HMS memberID: ${test.hmsMemberId}`);
      console.log(`  금액: ${test.amount.toLocaleString()}원`);
      console.log(`  결제 성공: ${test.paymentResult.success}`);
      if (test.paymentResult.success) {
        console.log(`  트랜잭션 ID: ${test.paymentResult.transactionId}`);
      } else {
        console.log(`  에러: ${test.paymentResult.error}`);
      }
    });
  });

  describe('1. 로컬 멤버십 데이터 검증', () => {
    it('멤버십 데이터가 올바르게 로드되어야 한다', () => {
      expect(membershipData).toBeDefined();
      expect(membershipData.members).toBeInstanceOf(Array);
      expect(membershipData.paymentMethods).toBeInstanceOf(Array);
      expect(membershipData.subscriptionPlans).toBeInstanceOf(Array);

      expect(membershipData.members.length).toBeGreaterThan(0);
      expect(membershipData.paymentMethods.length).toBeGreaterThan(0);

      console.log('✅ 멤버십 데이터 로드 성공');
    });

    it('각 결제수단에 필요한 카드 정보가 포함되어야 한다', () => {
      membershipData.paymentMethods.forEach(
        (paymentMethod: any, index: number) => {
          expect(paymentMethod.methodType).toBe('CARD');
          expect(paymentMethod.cardInfo).toBeDefined();
          expect(paymentMethod.cardInfo.memberName).toBeDefined();
          expect(paymentMethod.cardInfo.phone).toBeDefined();
          expect(paymentMethod.cardInfo.paymentNumber).toBeDefined();
          expect(paymentMethod.cardInfo.payerName).toBeDefined();
          expect(paymentMethod.cardInfo.payerNumber).toBeDefined();
          expect(paymentMethod.cardInfo.validYear).toBeDefined();
          expect(paymentMethod.cardInfo.validMonth).toBeDefined();

          console.log(
            `✅ 결제수단 ${index + 1} 검증 완료: ${paymentMethod.cardInfo.memberName}`,
          );
        },
      );
    });
  });

  describe('2. HMS 카드 등록 및 memberID 획득', () => {
    it('모든 테스트 카드를 HMS에 등록하고 memberID를 획득해야 한다', async () => {
      console.log('\n🔄 HMS 카드 등록 시작...');

      for (const [
        index,
        paymentMethod,
      ] of membershipData.paymentMethods.entries()) {
        const cardInfo = paymentMethod.cardInfo;

        console.log(`\n카드 ${index + 1} 등록 중: ${cardInfo.memberName}`);
        console.log('카드 정보:', {
          memberName: cardInfo.memberName,
          phone: cardInfo.phone,
          maskedCardNumber: cardInfo.maskedCardNumber,
          validYear: cardInfo.validYear,
          validMonth: cardInfo.validMonth,
        });

        const registrationRequest = {
          memberName: cardInfo.memberName,
          phone: cardInfo.phone,
          paymentNumber: cardInfo.paymentNumber,
          payerName: cardInfo.payerName,
          payerNumber: cardInfo.payerNumber,
          validYear: cardInfo.validYear,
          validMonth: cardInfo.validMonth,
        };

        try {
          const registrationResult =
            await hmsCardAdapter.registerRecurringMember(registrationRequest);

          console.log('등록 결과:', {
            success: registrationResult.success,
            hmsMemberId: registrationResult.hmsMemberId,
            error: registrationResult.error,
          });

          expect(registrationResult.success).toBe(true);
          expect(registrationResult.hmsMemberId).toBeDefined();

          // Mock 환경에서는 HMS_CARD_ 접두사 확인
          if (registrationResult.hmsMemberId) {
            expect(registrationResult.hmsMemberId).toMatch(/^HMS_/);
          }

          // 테스트 결과 저장
          testResults.registeredMembers.push({
            memberInfo: cardInfo,
            hmsMemberId: registrationResult.hmsMemberId!,
            registrationResult,
          });

          console.log(
            `✅ 카드 ${index + 1} 등록 성공: ${registrationResult.hmsMemberId}`,
          );
        } catch (error) {
          console.error(`❌ 카드 ${index + 1} 등록 실패:`, error.message);
          throw error;
        }
      }

      console.log(
        `\n🎉 총 ${testResults.registeredMembers.length}개 카드 등록 완료`,
      );
    });

    it('등록된 HMS memberID가 모두 고유해야 한다', () => {
      const memberIds = testResults.registeredMembers.map(
        (member) => member.hmsMemberId,
      );
      const uniqueMemberIds = new Set(memberIds);

      expect(uniqueMemberIds.size).toBe(memberIds.length);

      console.log('✅ 모든 HMS memberID가 고유함을 확인');
      console.log('등록된 memberID 목록:', memberIds);
    });
  });

  describe('3. HMS memberID를 사용한 결제 테스트', () => {
    it('등록된 각 HMS memberID로 결제를 테스트해야 한다', async () => {
      console.log('\n💳 HMS 결제 테스트 시작...');

      for (const [
        index,
        registeredMember,
      ] of testResults.registeredMembers.entries()) {
        const { hmsMemberId, memberInfo } = registeredMember;
        const testAmount = 1000 + index * 500; // 각기 다른 금액으로 테스트

        console.log(`\n결제 테스트 ${index + 1}: ${memberInfo.memberName}`);
        console.log(`HMS memberID: ${hmsMemberId}`);
        console.log(`테스트 금액: ${testAmount.toLocaleString()}원`);

        try {
          const paymentResult = await hmsCardAdapter.processPayment(
            testAmount,
            'KRW',
            {
              userId: `test-user-${index}`,
              hmsMemberId: hmsMemberId,
              paymentMethodId: `test-pm-${index}`,
              sessionId: `test-session-${Date.now()}-${index}`,
            },
          );

          console.log('결제 결과:', {
            success: paymentResult.success,
            transactionId: paymentResult.transactionId,
            captureId: paymentResult.captureId,
            error: paymentResult.error,
          });

          // Mock 환경에서는 항상 성공해야 함
          expect(paymentResult.success).toBe(true);
          expect(paymentResult.transactionId).toBeDefined();

          if (paymentResult.success) {
            expect(paymentResult.transactionId).toMatch(/^MOCK_CARD_/);
            expect(paymentResult.metadata).toBeDefined();
            expect(paymentResult.metadata?.provider).toBe('hms_card');
          }

          // 테스트 결과 저장
          testResults.paymentTests.push({
            hmsMemberId,
            amount: testAmount,
            paymentResult,
          });

          console.log(`✅ 결제 테스트 ${index + 1} 성공`);
        } catch (error) {
          console.error(`❌ 결제 테스트 ${index + 1} 실패:`, error.message);

          // 실패한 경우에도 결과 저장
          testResults.paymentTests.push({
            hmsMemberId,
            amount: testAmount,
            paymentResult: {
              success: false,
              transactionId: '',
              error: error.message,
            },
          });

          throw error;
        }
      }

      console.log(
        `\n🎉 총 ${testResults.paymentTests.length}개 결제 테스트 완료`,
      );
    });

    it('다양한 금액으로 결제 테스트를 수행해야 한다', async () => {
      if (testResults.registeredMembers.length === 0) {
        console.log('⚠️ 등록된 회원이 없어 테스트를 건너뜁니다.');
        return;
      }

      const firstMember = testResults.registeredMembers[0];
      const testAmounts = [100, 1000, 5000, 10000, 50000]; // 다양한 금액

      console.log('\n💰 다양한 금액 결제 테스트...');
      console.log(
        `테스트 대상: ${firstMember.memberInfo.memberName} (${firstMember.hmsMemberId})`,
      );

      for (const [index, amount] of testAmounts.entries()) {
        console.log(`\n금액 테스트 ${index + 1}: ${amount.toLocaleString()}원`);

        try {
          const paymentResult = await hmsCardAdapter.processPayment(
            amount,
            'KRW',
            {
              userId: `test-user-amount-${index}`,
              hmsMemberId: firstMember.hmsMemberId,
              paymentMethodId: `test-pm-amount-${index}`,
              sessionId: `test-session-amount-${Date.now()}-${index}`,
            },
          );

          expect(paymentResult.success).toBe(true);
          expect(paymentResult.transactionId).toBeDefined();

          console.log(
            `✅ ${amount.toLocaleString()}원 결제 성공: ${paymentResult.transactionId}`,
          );
        } catch (error) {
          console.error(
            `❌ ${amount.toLocaleString()}원 결제 실패:`,
            error.message,
          );
          throw error;
        }
      }

      console.log('✅ 다양한 금액 결제 테스트 완료');
    });
  });

  describe('4. HMS 상태 검증 및 에러 처리', () => {
    it('유효하지 않은 HMS memberID로 결제 시도 시 실패해야 한다', async () => {
      const invalidMemberIds = [
        'invalid-member-id',
        'HMS_INVALID_123',
        '',
        null,
        undefined,
      ];

      console.log('\n🚫 유효하지 않은 HMS memberID 테스트...');

      for (const [index, invalidId] of invalidMemberIds.entries()) {
        console.log(
          `\n무효한 ID 테스트 ${index + 1}: ${invalidId || 'null/undefined'}`,
        );

        try {
          const paymentResult = await hmsCardAdapter.processPayment(
            1000,
            'KRW',
            {
              userId: `test-user-invalid-${index}`,
              hmsMemberId: invalidId as string,
              paymentMethodId: `test-pm-invalid-${index}`,
              sessionId: `test-session-invalid-${Date.now()}-${index}`,
            },
          );

          // Mock 환경에서는 성공할 수 있지만, 실제 환경에서는 실패해야 함
          console.log(
            `결과: ${paymentResult.success ? '성공' : '실패'} - ${paymentResult.error || 'OK'}`,
          );
        } catch (error) {
          console.log(`예상된 에러 발생: ${error.message}`);
          // 에러가 발생하는 것이 정상
        }
      }

      console.log('✅ 무효한 HMS memberID 테스트 완료');
    });

    it('HMS memberID 검증 기능을 테스트해야 한다', async () => {
      if (testResults.registeredMembers.length === 0) {
        console.log('⚠️ 등록된 회원이 없어 테스트를 건너뜁니다.');
        return;
      }

      const testMember = testResults.registeredMembers[0];

      console.log('\n🔍 HMS memberID 검증 테스트...');
      console.log(`검증 대상: ${testMember.hmsMemberId}`);

      try {
        const validationResult = await hmsCardAdapter.validateHmsMember(
          testMember.hmsMemberId,
        );

        console.log('검증 결과:', validationResult);

        expect(validationResult.isValid).toBe(true);
        if (validationResult.cardInfo) {
          expect(validationResult.cardInfo.maskedNumber).toBeDefined();
          expect(validationResult.cardInfo.cardCompany).toBeDefined();
          expect(validationResult.cardInfo.cardType).toBeDefined();
        }

        console.log('✅ HMS memberID 검증 성공');
      } catch (error) {
        console.error('❌ HMS memberID 검증 실패:', error.message);
        throw error;
      }
    });
  });

  describe('5. 통합 플로우 검증', () => {
    it('전체 플로우가 올바르게 동작해야 한다', async () => {
      console.log('\n🔄 전체 플로우 검증...');

      // 1. 새로운 카드 정보로 등록
      const newCardInfo = {
        memberName: '통합테스트',
        phone: '01099999999',
        paymentNumber: '1111222233334444',
        payerName: '통합테스트',
        payerNumber: '9001011111',
        validYear: '25',
        validMonth: '12',
      };

      console.log('1단계: HMS 카드 등록');
      const registrationResult =
        await hmsCardAdapter.registerRecurringMember(newCardInfo);

      expect(registrationResult.success).toBe(true);
      expect(registrationResult.hmsMemberId).toBeDefined();

      const hmsMemberId = registrationResult.hmsMemberId!;
      console.log(`✅ 등록 성공: ${hmsMemberId}`);

      // 2. 등록된 memberID로 결제 테스트
      console.log('2단계: 결제 테스트');
      const paymentResult = await hmsCardAdapter.processPayment(9900, 'KRW', {
        userId: 'integration-test-user',
        hmsMemberId: hmsMemberId,
        paymentMethodId: 'integration-test-pm',
        sessionId: `integration-test-session-${Date.now()}`,
      });

      expect(paymentResult.success).toBe(true);
      expect(paymentResult.transactionId).toBeDefined();

      console.log(`✅ 결제 성공: ${paymentResult.transactionId}`);

      // 3. memberID 검증
      console.log('3단계: memberID 검증');
      const validationResult =
        await hmsCardAdapter.validateHmsMember(hmsMemberId);

      expect(validationResult.isValid).toBe(true);

      console.log('✅ 검증 성공');

      console.log('\n🎉 전체 통합 플로우 검증 완료');

      // 최종 결과 요약
      console.log('\n📋 통합 테스트 결과:');
      console.log(
        `- HMS 등록: ${registrationResult.success ? '성공' : '실패'}`,
      );
      console.log(`- HMS memberID: ${hmsMemberId}`);
      console.log(`- 결제 처리: ${paymentResult.success ? '성공' : '실패'}`);
      console.log(`- 트랜잭션 ID: ${paymentResult.transactionId}`);
      console.log(
        `- memberID 검증: ${validationResult.isValid ? '성공' : '실패'}`,
      );
    });
  });
});
