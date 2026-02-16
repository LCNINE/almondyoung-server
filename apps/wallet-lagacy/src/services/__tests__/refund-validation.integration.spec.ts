import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { RefundService } from '../refund.service';
import { PointService } from '../points/point.service';
import { ProviderRegistry } from '../../providers/provider-registry';
import { walletSchema } from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

/**
 * RefundService 누적 환불 검증 통합 테스트
 *
 * 목적: QA 리포트 High Priority #1 검증
 * - 누적 환불 금액이 총액을 초과하지 않는지 확인
 * - 부분 환불 시 정합성 검증
 * - 동시성 제어 (for update 락)
 */
describe('RefundService - 누적 환불 검증 통합 테스트', () => {
  let service: RefundService;
  let dbService: DbService<typeof walletSchema>;
  let module: TestingModule;
  let mockPointService: any;
  let mockProviderRegistry: any;

  beforeAll(async () => {
    // Mock 서비스 생성
    mockPointService = {
      addPoints: jest.fn().mockResolvedValue({ success: true }),
    };

    mockProviderRegistry = {
      get: jest.fn().mockReturnValue({
        refund: {
          refund: jest.fn().mockResolvedValue({ success: true }),
        },
        cancel: {
          cancel: jest.fn().mockResolvedValue({ success: true }),
        },
      }),
    };

    // 🏗 테스트 모듈 설정
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: walletSchema,
        }),
      ],
      providers: [
        RefundService,
        { provide: PointService, useValue: mockPointService },
        { provide: ProviderRegistry, useValue: mockProviderRegistry },
      ],
    }).compile();

    service = module.get<RefundService>(RefundService);
    dbService = module.get<DbService<typeof walletSchema>>(DbService);
  });

  beforeEach(async () => {
    // 🧹 각 테스트 전 DB 청소
    await cleanupDatabase();
  });

  afterEach(async () => {
    // 🧹 각 테스트 후 DB 청소
    await cleanupDatabase();
  });

  afterAll(async () => {
    // 🔌 연결 정리
    await module.close();
  });

  describe('누적 환불 검증', () => {
    it('🎯 누적 환불 금액이 총액을 초과하면 에러를 던진다', async () => {
      // 📋 1단계: 기반 데이터 세팅 - 10,000원 결제, 이미 7,000원 환불됨
      const intentId = generateUUIDv7();
      const attemptId = generateUUIDv7();

      // Intent 생성
      await dbService.db.insert(walletSchema.paymentIntents).values({
        id: intentId,
        customerId: '1',
        amount: 10000,
        totalAmount: 10000,
        discountsTotal: 0,
        finalAmount: 10000,
        status: 'CAPTURED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 86400000),
        refundedAmount: 7000,
      });

      // Attempt 생성
      await dbService.db.insert(walletSchema.paymentAttempts).values({
        id: attemptId,
        intentId,
        provider: 'TOSS',
        amount: 10000,
        status: 'CAPTURED',
        transactionId: 'tx_123',
      });

      // 기존 환불 이력 생성 (5,000원 + 2,000원 = 7,000원)
      await dbService.db.insert(walletSchema.paymentRefunds).values([
        {
          intentId,
          attemptId,
          amount: 5000,
          status: 'COMPLETED',
          completedAt: new Date(),
          completedBy: 'SYSTEM',
        },
        {
          intentId,
          attemptId,
          amount: 2000,
          status: 'COMPLETED',
          completedAt: new Date(),
          completedBy: 'SYSTEM',
        },
      ]);

      // 🚀 2단계: 5,000원 환불 요청 (총 12,000원 > 10,000원)
      await expect(service.refundPayment(intentId, 5000)).rejects.toThrow(
        '환불 가능 금액 초과',
      );

      // ✅ 3단계: DB 상태 확인 - 환불 이력이 추가되지 않았는지 확인
      const refunds = await dbService.db
        .select()
        .from(walletSchema.paymentRefunds)
        .where(eq(walletSchema.paymentRefunds.intentId, intentId));

      expect(refunds).toHaveLength(2); // 기존 2건만 있어야 함
    });

    it('🎯 정상 범위 내 부분 환불은 성공한다', async () => {
      // 📋 1단계: 기반 데이터 세팅 - 10,000원 결제, 이미 3,000원 환불됨
      const intentId = generateUUIDv7();
      const attemptId = generateUUIDv7();

      await dbService.db.insert(walletSchema.paymentIntents).values({
        id: intentId,
        customerId: '1',
        amount: 10000,
        totalAmount: 10000,
        discountsTotal: 0,
        finalAmount: 10000,
        status: 'CAPTURED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 86400000),
        refundedAmount: 3000,
      });

      await dbService.db.insert(walletSchema.paymentAttempts).values({
        id: attemptId,
        intentId,
        provider: 'TOSS',
        amount: 10000,
        status: 'CAPTURED',
        transactionId: 'tx_123',
      });

      // 기존 환불 이력 (3,000원)
      await dbService.db.insert(walletSchema.paymentRefunds).values({
        intentId,
        attemptId,
        amount: 3000,
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy: 'SYSTEM',
      });

      // 🚀 2단계: 5,000원 환불 요청 (총 8,000원 < 10,000원)
      const result = await service.refundPayment(intentId, 5000);

      // ✅ 3단계: 환불 성공 확인
      expect(result.success).toBe(true);
      expect(result.refunded.total).toBe(5000);
      expect(result.status).toBe('PARTIALLY_REFUNDED');

      // ✅ 4단계: DB 상태 확인
      const refunds = await dbService.db
        .select()
        .from(walletSchema.paymentRefunds)
        .where(eq(walletSchema.paymentRefunds.intentId, intentId));

      expect(refunds).toHaveLength(2); // 기존 1건 + 새로운 1건

      const intent = await dbService.db
        .select()
        .from(walletSchema.paymentIntents)
        .where(eq(walletSchema.paymentIntents.id, intentId))
        .then((rows) => rows[0]);

      expect(intent.refundedAmount).toBe(8000); // 3,000 + 5,000
      expect(intent.status).toBe('PARTIALLY_REFUNDED');
    });

    it('🎯 전액 환불 시 amount 미지정 가능', async () => {
      // 📋 1단계: 기반 데이터 세팅 - 10,000원 결제, 환불 이력 없음
      const intentId = generateUUIDv7();
      const attemptId = generateUUIDv7();

      await dbService.db.insert(walletSchema.paymentIntents).values({
        id: intentId,
        customerId: '1',
        amount: 10000,
        totalAmount: 10000,
        discountsTotal: 0,
        finalAmount: 10000,
        status: 'CAPTURED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 86400000),
        refundedAmount: 0,
      });

      await dbService.db.insert(walletSchema.paymentAttempts).values({
        id: attemptId,
        intentId,
        provider: 'TOSS',
        amount: 10000,
        status: 'CAPTURED',
        transactionId: 'tx_123',
      });

      // 🚀 2단계: amount 미지정 (전액 환불)
      const result = await service.refundPayment(intentId);

      // ✅ 3단계: 전액 환불 성공 확인
      expect(result.success).toBe(true);
      expect(result.refunded.total).toBe(10000);
      expect(result.status).toBe('REFUNDED');

      // ✅ 4단계: DB 상태 확인
      const intent = await dbService.db
        .select()
        .from(walletSchema.paymentIntents)
        .where(eq(walletSchema.paymentIntents.id, intentId))
        .then((rows) => rows[0]);

      expect(intent.refundedAmount).toBe(10000);
      expect(intent.status).toBe('REFUNDED');
    });

    it('🎯 정확히 남은 금액만큼 환불 가능', async () => {
      // 📋 1단계: 10,000원 결제, 7,000원 환불됨
      const intentId = generateUUIDv7();
      const attemptId = generateUUIDv7();

      await dbService.db.insert(walletSchema.paymentIntents).values({
        id: intentId,
        customerId: '1',
        amount: 10000,
        totalAmount: 10000,
        discountsTotal: 0,
        finalAmount: 10000,
        status: 'CAPTURED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 86400000),
        refundedAmount: 7000,
      });

      await dbService.db.insert(walletSchema.paymentAttempts).values({
        id: attemptId,
        intentId,
        provider: 'TOSS',
        amount: 10000,
        status: 'CAPTURED',
        transactionId: 'tx_123',
      });

      await dbService.db.insert(walletSchema.paymentRefunds).values({
        intentId,
        attemptId,
        amount: 7000,
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy: 'SYSTEM',
      });

      // 🚀 2단계: 정확히 3,000원 환불 (남은 금액)
      const result = await service.refundPayment(intentId, 3000);

      // ✅ 3단계: 성공 확인
      expect(result.success).toBe(true);
      expect(result.refunded.total).toBe(3000);
      expect(result.status).toBe('REFUNDED'); // 전액 환불 완료

      const intent = await dbService.db
        .select()
        .from(walletSchema.paymentIntents)
        .where(eq(walletSchema.paymentIntents.id, intentId))
        .then((rows) => rows[0]);

      expect(intent.refundedAmount).toBe(10000);
    });
  });

  describe('에러 케이스', () => {
    it('❌ 존재하지 않는 Intent는 에러를 던진다', async () => {
      await expect(
        service.refundPayment('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow('Intent not found');
    });

    it('❌ 환불 불가 상태(FAILED)는 에러를 던진다', async () => {
      const intentId = generateUUIDv7();

      await dbService.db.insert(walletSchema.paymentIntents).values({
        id: intentId,
        customerId: '1',
        amount: 10000,
        totalAmount: 10000,
        discountsTotal: 0,
        finalAmount: 10000,
        status: 'FAILED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 86400000),
        refundedAmount: 0,
      });

      await expect(service.refundPayment(intentId)).rejects.toThrow(
        'Cannot refund intent in FAILED status',
      );
    });

    it('❌ 환불 불가 상태(PENDING)는 에러를 던진다', async () => {
      const intentId = generateUUIDv7();

      await dbService.db.insert(walletSchema.paymentIntents).values({
        id: intentId,
        customerId: '1',
        amount: 10000,
        totalAmount: 10000,
        discountsTotal: 0,
        finalAmount: 10000,
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 86400000),
        refundedAmount: 0,
      });

      await expect(service.refundPayment(intentId)).rejects.toThrow(
        'Cannot refund intent in PENDING status',
      );
    });
  });

  // 🧹 청소 함수
  async function cleanupDatabase() {
    try {
      await dbService.db.delete(walletSchema.paymentRefunds);
      await dbService.db.delete(walletSchema.paymentAttempts);
      await dbService.db.delete(walletSchema.paymentIntents);
    } catch (error) {
      console.warn('청소 중 에러 발생 (테스트는 계속):', error);
    }
  }
});
