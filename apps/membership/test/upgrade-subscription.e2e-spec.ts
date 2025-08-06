import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '@app/db';
import * as schema from '../src/shared/schemas/entities/schema';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * E2E 테스트: 구독 업그레이드
 * - 'Basic' 플랜을 구독 중인 사용자가 'Premium' 플랜으로 업그레이드하는 시나리오를 검증합니다.
 */
describe('Subscription Upgrade E2E Test', () => {
  let app: INestApplication;
  let dbService: DbService<typeof schema>;

  // 테스트 실행마다 고유한 ID들을 생성하여 완벽한 독립성 보장
  const testUserId = randomUUID();
  const testTierIds: string[] = [];
  const testPlanIds: string[] = [];
  let initialSubscriptionId: string;
  let newSubscriptionId: string; // 업그레이드 후 생성될 새 구독 ID

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    dbService = moduleFixture.get<DbService<typeof schema>>(DbService);

    // ===== [원자성] 테스트 실행 전, 이전 테스트의 잔여 데이터 삭제 =====
    await dbService.db.delete(schema.users).where(eq(schema.users.id, testUserId));
    
    // ===== [전제 조건] 'Basic 플랜 구독 중인 사용자' 상태를 DB에 직접 생성 =====
    await dbService.db.transaction(async (tx) => {
      // 1. 사용자 생성
      await tx.insert(schema.users).values({ id: testUserId, });

      // 2. 티어와 플랜 (Basic, Premium) 생성
      const tiers = await tx.insert(schema.subscriptionTiers).values([
        { code: `E2E_UPG_${randomUUID().substring(0,8)}`, name: 'E2E Basic Tier', priorityLevel: 1301 },
        { code: `E2E_UPG_${randomUUID().substring(0,8)}`, name: 'E2E Premium Tier', priorityLevel: 1302 },
      ]).returning();
      testTierIds.push(tiers[0].id, tiers[1].id);

      const plans = await tx.insert(schema.subscriptionPlans).values([
        { tierId: testTierIds[0], price: 1000, durationDays: 30 }, // Basic
        { tierId: testTierIds[1], price: 2000, durationDays: 30 }, // Premium
      ]).returning();
      testPlanIds.push(plans[0].id, plans[1].id);

      // 3. Foreign Key 순서에 맞춰 초기 구독 상태(Basic) 생성
      const startedAt = new Date().toISOString().split('T')[0];
      const subscription = await tx.insert(schema.subscriptions).values({
        userId: testUserId,
        planId: testPlanIds[0], // Basic 플랜
        status: 'ACTIVE', startedAt, changeType: 'INITIAL',
      }).returning();
      initialSubscriptionId = subscription[0].id;

      const event = await tx.insert(schema.subscriptionEvents).values({
        eventType: 'SUBSCRIPTION_STARTED', userId: testUserId, subscriptionId: initialSubscriptionId,
        effectiveDate: startedAt, eventPayload: { reason: 'Initial E2E setup' },
      }).returning();
      
      await tx.insert(schema.subscriptionRights).values({
        userId: testUserId, tierId: testTierIds[0], subscriptionId: initialSubscriptionId,
        isActive: true, createdByEventId: event[0].id, startsAt: startedAt,
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      });
    });
  });

  afterAll(async () => {
    // 생성된 모든 테스트 데이터 정리
    if (dbService) {
      await dbService.db.delete(schema.subscriptionRights).where(eq(schema.subscriptionRights.userId, testUserId));
      await dbService.db.delete(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.userId, testUserId));
      await dbService.db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, testUserId));
      if (testPlanIds.length > 0) await dbService.db.delete(schema.subscriptionPlans).where(inArray(schema.subscriptionPlans.id, testPlanIds));
      if (testTierIds.length > 0) await dbService.db.delete(schema.subscriptionTiers).where(inArray(schema.subscriptionTiers.id, testTierIds));
      await dbService.db.delete(schema.users).where(eq(schema.users.id, testUserId));
    }
    await app.close();
  });

  describe('시나리오: 기존 구독자의 업그레이드', () => {
    it('Step 1: 사용자가 Premium 플랜으로 성공적으로 업그레이드한다', async () => {
        const response = await request(app.getHttpServer())
            .post('/subscriptions/upgrade')
            .query({ userId: testUserId })
            .send({ newPlanId: testPlanIds[1] }) // Premium 플랜 ID
            .expect(201);
        
        // 응답 검증
        newSubscriptionId = response.body.id;
        expect(newSubscriptionId).toBeDefined();
        expect(newSubscriptionId).not.toBe(initialSubscriptionId); // 새 구독이 생성되었는지 확인
        expect(response.body.planId).toBe(testPlanIds[1]);
    });

    it('Step 2: 업그레이드 후 DB 상태가 올바르게 변경되었는지 검증한다', async () => {
        // [DB 신뢰 원칙] DB를 직접 조회하여 최종 상태를 검증
        
        // 1. 기존 구독(Basic) 상태 확인
        const oldSub = await dbService.db.query.subscriptions.findFirst({
            where: eq(schema.subscriptions.id, initialSubscriptionId)
        });
        expect(oldSub?.status).toBe('UPGRADED'); // 상태가 'UPGRADED'로 변경되었는지 확인 (서비스 로직에 따라 다를 수 있음)

        // 2. 기존 구독 권한(Rights) 확인
        const oldRights = await dbService.db.query.subscriptionRights.findFirst({
            where: eq(schema.subscriptionRights.subscriptionId, initialSubscriptionId)
        });
        expect(oldRights?.isActive).toBe(false); // 기존 권한은 비활성화되어야 함

        // 3. 새 구독(Premium) 상태 확인
        const newSub = await dbService.db.query.subscriptions.findFirst({
            where: eq(schema.subscriptions.id, newSubscriptionId)
        });
        expect(newSub?.status).toBe('ACTIVE');
        expect(newSub?.planId).toBe(testPlanIds[1]);

        // 4. 새 구독 권한(Rights) 확인
        const newRights = await dbService.db.query.subscriptionRights.findFirst({
            where: eq(schema.subscriptionRights.subscriptionId, newSubscriptionId)
        });
        expect(newRights?.isActive).toBe(true); // 새 권한은 활성화되어야 함
    });
  });
});