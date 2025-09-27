import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { getTsid } from 'tsid-ts';
import * as fs from 'fs';
import * as path from 'path';

// =======================================================
// 🐘 테스트 대상 모듈 및 서비스 전체 임포트
// =======================================================
import { AppModule } from '../../app.module';
import { PaymentService } from '../payment.service';
import { PaymentIntentService } from '../intents/intent.service';

import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import {
  PaymentType,
  ProviderType,
} from '../../providers/payment-provider.interface';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import { PaymentExecutorService } from '../payment';

describe('PaymentService BNPL Integration Tests', () => {
  let module: TestingModule;
  let dbService: DbService<typeof schema>;
  // --- 테스트에 사용할 주력 서비스들 ---
  let paymentService: PaymentService;
  let intentService: PaymentIntentService;
  let profileService: PaymentProfileService;

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
  });

  // 🧹 각 테스트 실행 전, 관련 테이블을 모두 깨끗하게 비웁니다.
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await module.close();
  });

  it('🎯 [성공] HMS BNPL 프로필(동의서 포함) 생성부터 결제 완료까지의 전체 흐름을 테스트합니다.', async () => {
    // =======================================================
    // 1. Given (주어진 상황)
    // =======================================================
    const userId = `user_${getTsid().toString()}`;
    const paymentAmount = 150000;

    const agreementFile = {
      file: Buffer.from('This is a test agreement file for BNPL.'),
      filename: 'bnpl_agreement.pdf',
    };

    const bnplProfileDto = {
      payerName: '김비엔',
      phone: '01098765432',
      paymentCompany: '088', // 예: 신한은행
      paymentNumber: '110222333444',
      payerNumber: '950101',
      name: '나의 BNPL 계좌',
      agreementFile: agreementFile,
    };

    // =======================================================
    // 2. When (행동)
    // =======================================================
    // hms-api-wrapper의 실제 구현체가 호출됩니다.
    const { profileId } =
      await profileService.createHmsBnplProfileWithAgreement(
        userId,
        bnplProfileDto,
      );
    expect(profileId).toBeDefined();

    const intent = await intentService.createIntent({
      customerId: userId,
      amount: paymentAmount,
      type: 'BNPL_CAPTURE',
    });
    expect(intent).toBeDefined();
    expect(intent.status).toBe('PENDING');

    // hms-api-wrapper의 실제 구현체가 호출됩니다.
    const paymentResult = await paymentService.processPaymentByIntent(
      intent.id,
      ProviderType.HMS_BNPL,
      { profileId },
    );

    // =======================================================
    // 3. Then (결과 검증)
    // =======================================================
    expect(paymentResult.success).toBe(true);
    expect(paymentResult.transactionId).toBeDefined();

    // --- 3-1. DB: 프로필이 올바르게 저장되었는지 검증 ---
    const savedProfile = await dbService.db.query.paymentProfiles.findFirst({
      where: eq(schema.paymentProfiles.id, profileId),
    });
    const savedCmsBatch = await dbService.db.query.cmsBatchProfiles.findFirst({
      where: eq(schema.cmsBatchProfiles.id, profileId),
    });

    expect(savedProfile).toBeDefined();
    expect(savedProfile?.userId).toBe(userId);
    expect(savedProfile?.status).toBe('ACTIVE');
    expect(savedProfile?.kind).toBe('BANK_ACCOUNT');
    expect(savedProfile?.provider).toBe(ProviderType.HMS_BNPL);
    expect(savedCmsBatch).toBeDefined();
    expect(savedCmsBatch?.payerName).toBe(bnplProfileDto.payerName);

    // --- 3-2. DB: Intent 상태가 'CAPTURED'로 변경되었는지 검증 ---
    const updatedIntent = await intentService.findIntentById(intent.id);
    expect(updatedIntent?.status).toBe('CAPTURED');

    // --- 3-3. DB: Payment Attempt가 성공적으로 기록되었는지 검증 ---
    const savedAttempt = await dbService.db.query.paymentAttempts.findFirst({
      where: eq(schema.paymentAttempts.intentId, intent.id),
    });
    expect(savedAttempt).toBeDefined();
    expect(savedAttempt?.status).toBe('CAPTURED');
    expect(savedAttempt?.provider).toBe(ProviderType.HMS_BNPL);
    expect(savedAttempt?.amount).toBe(paymentAmount);
  });

  /**
   * DB 청소 헬퍼 함수
   */
  async function cleanupDatabase() {
    await dbService.db.delete(schema.paymentAttempts);
    await dbService.db.delete(schema.paymentRefunds);
    await dbService.db.delete(schema.paymentIntents);
    await dbService.db.delete(schema.cmsCardProfiles);
    await dbService.db.delete(schema.cmsBatchProfiles);
    await dbService.db.delete(schema.paymentProfiles);
  }
});
