import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { getTsid } from 'tsid-ts';

// =======================================================
// 🐘 테스트 대상 모듈 및 서비스 전체 임포트
// =======================================================
import { AppModule } from '../../app.module';
import { PaymentService } from '../payment.service';
import { PaymentIntentService } from '../intents/intent.service';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import { BnplService } from '../bnpl/bnpl.service';
import { PaymentExecutorService } from '../payment';

import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import {
  PaymentType,
  ProviderType,
} from '../../providers/payment-provider.interface';

describe('BNPL 통합 테스트 - 전체 플로우', () => {
  let module: TestingModule;
  let dbService: DbService<typeof schema>;

  // --- 테스트에 사용할 주력 서비스들 ---
  let paymentService: PaymentService;
  let intentService: PaymentIntentService;
  let profileService: PaymentProfileService;
  let bnplService: BnplService;
  let paymentExecutorService: PaymentExecutorService;

  beforeAll(async () => {
    // 🏗 테스트 모듈 설정: AppModule 전체를 어떠한 변경도 없이 그대로 가져옵니다.
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema,
        }),
        AppModule,
      ],
    }).compile();

    // --- 서비스 인스턴스 가져오기 ---
    dbService = module.get<DbService<typeof schema>>(DbService);
    paymentService = module.get<PaymentService>(PaymentService);
    intentService = module.get<PaymentIntentService>(PaymentIntentService);
    profileService = module.get<PaymentProfileService>(PaymentProfileService);
    bnplService = module.get<BnplService>(BnplService);
    paymentExecutorService = module.get<PaymentExecutorService>(
      PaymentExecutorService,
    );
  });

  // 🧹 각 테스트 실행 전, 관련 테이블을 모두 깨끗하게 비웁니다.
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await module.close();
  });

  describe('🎯 BNPL 전체 플로우 테스트', () => {
    it('🎯 [성공] BNPL 프로필 생성 → 계정 생성 → 상품 구매 → 결제 완료까지의 전체 흐름', async () => {
      // =======================================================
      // 1. Given (주어진 상황)
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const paymentAmount = 150000; // 15만원 상품 구매
      const creditLimit = 500000; // 50만원 한도

      const agreementFile = {
        file: Buffer.from('This is a test BNPL agreement file.'),
        filename: 'bnpl_agreement.pdf',
      };

      const bnplProfileDto = {
        payerName: '김비엔피엘',
        phone: '01098765432',
        paymentCompany: '088', // 신한은행
        paymentNumber: '110222333444',
        payerNumber: '950101',
        name: '나의 BNPL 계좌',
        agreementFile: agreementFile,
      };

      // =======================================================
      // 2. When (행동) - 단계별 플로우 실행
      // =======================================================

      // 🔹 Step 1: BNPL 프로필 생성 (출금 동의서 포함)
      const { profileId } =
        await profileService.createHmsBnplProfileWithAgreement(
          userId,
          bnplProfileDto,
        );
      expect(profileId).toBeDefined();

      // 🔹 Step 2: BNPL 계정 생성 (신용 한도 설정)
      const bnplAccount = await bnplService.createAccount(userId, creditLimit);
      expect(bnplAccount).toBeDefined();
      expect(bnplAccount.creditLimit).toBe(creditLimit);
      expect(bnplAccount.availableLimit).toBe(creditLimit);

      // 🔹 Step 3: 결제 Intent 생성
      const intent = await intentService.createIntent({
        customerId: userId,
        amount: paymentAmount,
        type: 'BNPL_CAPTURE',
      });
      expect(intent).toBeDefined();
      expect(intent.status).toBe('PENDING');

      // 🔹 Step 4: BNPL 결제 처리 (상품 구매)
      const paymentResult = await paymentService.processPaymentByIntent(
        intent.id,
        ProviderType.HMS_BNPL,
        { profileId },
      );

      // =======================================================
      // 3. Then (결과 검증)
      // =======================================================

      // 🔍 Step 1 검증: 프로필이 올바르게 저장되었는지
      const savedProfile = await dbService.db.query.paymentProfiles.findFirst({
        where: eq(schema.paymentProfiles.id, profileId),
      });
      const savedCmsBatch = await dbService.db.query.cmsBatchProfiles.findFirst(
        {
          where: eq(schema.cmsBatchProfiles.id, profileId),
        },
      );

      expect(savedProfile).toBeDefined();
      expect(savedProfile?.userId).toBe(userId);
      expect(savedProfile?.status).toBe('ACTIVE');
      expect(savedProfile?.kind).toBe('BANK_ACCOUNT');
      expect(savedProfile?.provider).toBe(ProviderType.HMS_BNPL);

      expect(savedCmsBatch).toBeDefined();
      expect(savedCmsBatch?.payerName).toBe(bnplProfileDto.payerName);
      expect(savedCmsBatch?.paymentCompany).toBe(bnplProfileDto.paymentCompany);

      // 🔍 Step 2 검증: BNPL 계정이 올바르게 생성되었는지
      const savedBnplAccount = await dbService.db.query.bnplAccounts.findFirst({
        where: eq(schema.bnplAccounts.userId, userId),
      });

      expect(savedBnplAccount).toBeDefined();
      expect(savedBnplAccount?.creditLimit).toBe(creditLimit);
      expect(savedBnplAccount?.availableLimit).toBe(
        creditLimit - paymentAmount,
      ); // 한도 차감 확인
      expect(savedBnplAccount?.status).toBe('ACTIVE');

      // 🔍 Step 3 검증: Intent 상태가 'AUTHORIZED'인지 (아직 실제 결제 안됨)
      const updatedIntent = await intentService.findIntentById(intent.id);
      expect(updatedIntent?.status).toBe('AUTHORIZED');

      // 🔍 Step 4 검증: Payment Attempt가 성공적으로 기록되었는지
      const savedAttempt = await dbService.db.query.paymentAttempts.findFirst({
        where: eq(schema.paymentAttempts.intentId, intent.id),
      });

      expect(savedAttempt).toBeDefined();
      // BNPL 주문 시점에는 AUTHORIZED (30일 후 CMS 배치에서 CAPTURED로 변환)
      expect(savedAttempt?.status).toBe('AUTHORIZED');
      expect(savedAttempt?.provider).toBe(ProviderType.HMS_BNPL);
      expect(savedAttempt?.amount).toBe(paymentAmount);

      // 🔍 Step 5 검증: BNPL 이벤트가 올바르게 생성되었는지
      const bnplEvents = await dbService.db.query.bnplEvents.findMany({
        where: eq(schema.bnplEvents.accountId, savedBnplAccount!.id),
      });

      expect(bnplEvents).toHaveLength(1);
      expect(bnplEvents[0].eventType).toBe('PURCHASE');
      expect(bnplEvents[0].eventCategory).toBe('CREDIT');
      expect(bnplEvents[0].amount).toBe(paymentAmount);
      expect(bnplEvents[0].status).toBe('PENDING');

      // 🔍 Step 6 검증: BNPL 이벤트 상세 정보가 올바르게 생성되었는지
      const bnplEventDetails =
        await dbService.db.query.bnplEventDetails.findMany({
          where: eq(schema.bnplEventDetails.eventId, bnplEvents[0].id),
        });

      expect(bnplEventDetails).toHaveLength(1);
      expect(bnplEventDetails[0].eventType).toBe('PURCHASE');
      expect(bnplEventDetails[0].amount).toBe(paymentAmount);
      expect(bnplEventDetails[0].availableBefore).toBe(creditLimit);
      expect(bnplEventDetails[0].availableAfter).toBe(
        creditLimit - paymentAmount,
      );
      expect(bnplEventDetails[0].purchaseEventDetailId).toBe(
        bnplEventDetails[0].id,
      ); // 자기 참조
      expect(bnplEventDetails[0].originalEventDetailId).toBe(
        bnplEventDetails[0].id,
      ); // 자기 참조

      // 🔍 최종 검증: 결제 결과 확인
      expect(paymentResult.success).toBe(true);
      expect(paymentResult.transactionId).toBeDefined();
    });

    it('🎯 [실패] 한도 부족 시 BNPL 결제 실패', async () => {
      // =======================================================
      // 1. Given (주어진 상황)
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const paymentAmount = 600000; // 60만원 상품 구매 (한도 초과)
      const creditLimit = 500000; // 50만원 한도

      const bnplProfileDto = {
        payerName: '김한도부족',
        phone: '01098765432',
        paymentCompany: '088',
        paymentNumber: '110222333444',
        payerNumber: '950101',
        name: '한도 부족 테스트 계좌',
        agreementFile: {
          file: Buffer.from('Test agreement'),
          filename: 'test.pdf',
        },
      };

      // =======================================================
      // 2. When & Then (행동 및 검증)
      // =======================================================

      // 프로필 및 계정 생성
      const { profileId } =
        await profileService.createHmsBnplProfileWithAgreement(
          userId,
          bnplProfileDto,
        );
      await bnplService.createAccount(userId, creditLimit);

      const intent = await intentService.createIntent({
        customerId: userId,
        amount: paymentAmount,
        type: 'BNPL_CAPTURE',
      });

      // 한도 부족으로 결제 실패 예상
      await expect(
        paymentService.processPaymentByIntent(
          intent.id,
          ProviderType.HMS_BNPL,
          { profileId },
        ),
      ).rejects.toThrow();

      // Intent 상태는 트랜잭션 롤백으로 인해 PENDING으로 유지됨 (설계 의도)
      const unchangedIntent = await intentService.findIntentById(intent.id);
      expect(unchangedIntent?.status).toBe('PENDING');

      // BNPL 계정 한도는 변경되지 않았는지 확인
      const unchangedAccount = await dbService.db.query.bnplAccounts.findFirst({
        where: eq(schema.bnplAccounts.userId, userId),
      });
      expect(unchangedAccount?.availableLimit).toBe(creditLimit); // 한도 그대로 유지
    });

    it('🎯 [실패] BNPL 계정이 없는 사용자의 결제 시도', async () => {
      // =======================================================
      // 1. Given (주어진 상황)
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const paymentAmount = 150000;

      const bnplProfileDto = {
        payerName: '김계정없음',
        phone: '01098765432',
        paymentCompany: '088',
        paymentNumber: '110222333444',
        payerNumber: '950101',
        name: '계정 없음 테스트',
        agreementFile: {
          file: Buffer.from('Test agreement'),
          filename: 'test.pdf',
        },
      };

      // =======================================================
      // 2. When & Then (행동 및 검증)
      // =======================================================

      // 프로필만 생성하고 BNPL 계정은 생성하지 않음
      const { profileId } =
        await profileService.createHmsBnplProfileWithAgreement(
          userId,
          bnplProfileDto,
        );

      const intent = await intentService.createIntent({
        customerId: userId,
        amount: paymentAmount,
        type: 'BNPL_CAPTURE',
      });

      // BNPL 계정이 없어서 결제 실패 예상
      await expect(
        paymentService.processPaymentByIntent(
          intent.id,
          ProviderType.HMS_BNPL,
          { profileId },
        ),
      ).rejects.toThrow('BNPL account not found');

      // Intent 상태는 트랜잭션 롤백으로 인해 PENDING으로 유지됨 (설계 의도)
      const unchangedIntent = await intentService.findIntentById(intent.id);
      expect(unchangedIntent?.status).toBe('PENDING');
    });

    it('🎯 [성공] 여러 번의 BNPL 구매 후 한도 누적 차감 확인', async () => {
      // =======================================================
      // 1. Given (주어진 상황)
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const creditLimit = 500000; // 50만원 한도
      const firstPurchase = 150000; // 첫 번째 구매: 15만원
      const secondPurchase = 200000; // 두 번째 구매: 20만원

      const bnplProfileDto = {
        payerName: '김다중구매',
        phone: '01098765432',
        paymentCompany: '088',
        paymentNumber: '110222333444',
        payerNumber: '950101',
        name: '다중 구매 테스트 계좌',
        agreementFile: {
          file: Buffer.from('Test agreement'),
          filename: 'test.pdf',
        },
      };

      // =======================================================
      // 2. When (행동)
      // =======================================================

      // 프로필 및 계정 생성
      const { profileId } =
        await profileService.createHmsBnplProfileWithAgreement(
          userId,
          bnplProfileDto,
        );
      await bnplService.createAccount(userId, creditLimit);

      // 첫 번째 구매
      const firstIntent = await intentService.createIntent({
        customerId: userId,
        amount: firstPurchase,
        type: 'BNPL_CAPTURE',
      });

      const firstResult = await paymentService.processPaymentByIntent(
        firstIntent.id,
        ProviderType.HMS_BNPL,
        { profileId },
      );

      // 두 번째 구매
      const secondIntent = await intentService.createIntent({
        customerId: userId,
        amount: secondPurchase,
        type: 'BNPL_CAPTURE',
      });

      const secondResult = await paymentService.processPaymentByIntent(
        secondIntent.id,
        ProviderType.HMS_BNPL,
        { profileId },
      );

      // =======================================================
      // 3. Then (결과 검증)
      // =======================================================

      // 두 번의 구매 모두 성공
      expect(firstResult.success).toBe(true);
      expect(secondResult.success).toBe(true);

      // BNPL 계정 한도가 누적 차감되었는지 확인
      const finalAccount = await dbService.db.query.bnplAccounts.findFirst({
        where: eq(schema.bnplAccounts.userId, userId),
      });

      const expectedAvailableLimit =
        creditLimit - firstPurchase - secondPurchase;
      expect(finalAccount?.availableLimit).toBe(expectedAvailableLimit);

      // BNPL 이벤트가 2개 생성되었는지 확인
      const bnplEvents = await dbService.db.query.bnplEvents.findMany({
        where: eq(schema.bnplEvents.accountId, finalAccount!.id),
      });

      expect(bnplEvents).toHaveLength(2);
      expect(bnplEvents.every((event) => event.eventType === 'PURCHASE')).toBe(
        true,
      );
      expect(
        bnplEvents.every((event) => event.eventCategory === 'CREDIT'),
      ).toBe(true);
    }, 15000); // 15초 타임아웃
  });

  /**
   * DB 청소 헬퍼 함수
   */
  async function cleanupDatabase() {
    try {
      // 외래키 제약 때문에 자식부터 삭제
      await dbService.db.delete(schema.bnplEvents);
      await dbService.db.delete(schema.bnplAccounts);
      await dbService.db.delete(schema.paymentAttempts);
      await dbService.db.delete(schema.paymentRefunds);
      await dbService.db.delete(schema.paymentIntents);
      await dbService.db.delete(schema.cmsCardProfiles);
      await dbService.db.delete(schema.cmsBatchProfiles);
      await dbService.db.delete(schema.paymentProfiles);
    } catch (error) {
      console.warn('청소 중 에러 발생 (테스트는 계속):', error);
    }
  }
});
