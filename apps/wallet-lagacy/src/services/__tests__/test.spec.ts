import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { getTsid } from 'tsid-ts';

// =======================================================
// 🐘 테스트 대상 모듈 및 서비스 전체 임포트
// =======================================================
import { AppModule } from '../../app.module';
import { PaymentService } from '../payment.service';
import { PaymentIntentService } from '../intents/intent.service';

import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ProviderType } from '../../providers/payment-provider.interface';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import { CreateHmsCardProfileSchema } from '../../controllers/payment.controller';
import z from 'zod';

describe('PaymentService Integration Tests', () => {
  let module: TestingModule;
  let dbService: DbService<typeof schema>;
  // --- 테스트에 사용할 주력 서비스들 ---
  let paymentService: PaymentService;
  let intentService: PaymentIntentService;
  let profileService: PaymentProfileService;

  beforeAll(async () => {
    // 🏗 테스트 모듈 설정: WalletModule 전체를 가져와 실제 앱 환경과 동일하게 구성
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
        AppModule, // 우리가 만든 모든 Provider와 Service가 포함된 모듈
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

  // =======================================================
  // 🧪 테스트 시나리오: HMS 카드 프로필 등록 후 결제 성공
  // =======================================================
  it('🎯 [성공] HMS 카드 프로필 생성부터 결제 완료까지의 전체 흐름을 테스트합니다.', async () => {
    // =======================================================
    // 1. Given (주어진 상황)
    // =======================================================
    const userId = `user_${getTsid().toString()}`;
    const paymentAmount = 50000;

    // =======================================================
    // 2. When (행동)
    // =======================================================

    // --- 2-1. HMS 카드 결제 프로필 생성 ---
    // ✨ [단일 출처] Omit을 사용하여 userId를 제외한 DTO를 타입 안전하게 만듭니다.
    const profileDto: z.infer<typeof CreateHmsCardProfileSchema> = {
      payerName: '홍길동',
      phone: '01012345678',
      paymentCompany: '03',
      memberName: '내 신용카드',
      paymentNumber: '1111222233334444',
      validUntil: '12',
      validYear: '25',
      validMonth: '12',
      password: '11',
      payerNumber: '900101',
      userId: userId,
      memberId: '12345672890',
    };
    const profileId = await profileService.createHmsCardProfile(profileDto);
    expect(profileId).toBeDefined();

    // --- 2-2. 생성된 프로필로 결제 의도(Intent) 생성 ---
    const intent = await intentService.createIntent({
      customerId: userId,
      amount: paymentAmount,
      type: 'ORDER',
    });
    expect(intent).toBeDefined();
    expect(intent.status).toBe('PENDING');

    // --- 2-3. 생성된 Intent와 Profile로 결제 실행 ---
    const paymentResult = await paymentService.processPaymentByIntent(
      intent.id,
      ProviderType.HMS_CARD,
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
    const savedCmsCard = await dbService.db.query.cmsCardProfiles.findFirst({
      where: eq(schema.cmsCardProfiles.id, profileId),
    });

    expect(savedProfile).toBeDefined();
    expect(savedProfile?.userId).toBe(userId);
    expect(savedProfile?.status).toBe('ACTIVE');
    expect(savedCmsCard).toBeDefined();
    expect(savedCmsCard?.payerName).toBe('홍길동');
    // ✨ [규약 검증] 생성된 memberId가 20자 이하인지 확인
    expect(savedCmsCard!.memberId.length).toBeLessThanOrEqual(20);

    // --- 3-2. DB: Intent 상태가 'CAPTURED'로 변경되었는지 검증 ---
    const updatedIntent = await intentService.findIntentById(intent.id);
    expect(updatedIntent?.status).toBe('CAPTURED');

    // --- 3-3. DB: Payment Attempt가 성공적으로 기록되었는지 검증 ---
    const savedAttempt = await dbService.db.query.paymentAttempts.findFirst({
      where: eq(schema.paymentAttempts.intentId, intent.id),
    });
    expect(savedAttempt).toBeDefined();
    expect(savedAttempt?.status).toBe('CAPTURED');
    expect(savedAttempt?.provider).toBe(ProviderType.HMS_CARD);
    expect(savedAttempt?.amount).toBe(paymentAmount);
  });

  /**
   * DB 청소 헬퍼 함수
   * 외래 키 제약 조건을 고려하여 자식 테이블부터 삭제합니다.
   */
  async function cleanupDatabase() {
    // 순서가 매우 중요합니다!
    await dbService.db.delete(schema.paymentAttempts);
    await dbService.db.delete(schema.paymentRefunds);
    await dbService.db.delete(schema.paymentIntents);
    await dbService.db.delete(schema.cmsCardProfiles);
    await dbService.db.delete(schema.cmsBatchProfiles);
    await dbService.db.delete(schema.paymentProfiles);
  }
});
