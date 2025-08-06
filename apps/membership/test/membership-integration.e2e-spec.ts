import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '@app/db';
import * as schema from '../src/shared/schemas/entities/schema';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * E2E 테스트: 신규 구독, 조회, 취소 (최종 안정화 버전)
 * - API 응답 대신 DB 직접 조회로 상태를 확인하여 DTO 변경에 강한 테스트로 개선
 */
describe('New Subscription, Verification, and Cancellation E2E Test', () => {
  let app: INestApplication;
  let dbService: DbService<typeof schema>;

  const testUserId = randomUUID();
  const testTierIds: string[] = [];
  const testPlanIds: string[] = [];
  let currentSubscriptionId: string | null = null;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    dbService = moduleFixture.get<DbService<typeof schema>>(DbService);
    
    // 테스트 실행 전, 이전 테스트의 잔여 데이터 삭제
    await dbService.db.delete(schema.users).where(eq(schema.users.id, testUserId));
    
    // 테스트 데이터 생성
    await dbService.db.insert(schema.users).values({
      id: testUserId,

    });
    
    await dbService.db.transaction(async (tx) => {
      const tiers = await tx.insert(schema.subscriptionTiers).values([
        { code: `E2E_${randomUUID().substring(0,8)}`, name: 'E2E Basic Tier', priorityLevel: 1201 },
      ]).returning();
      testTierIds.push(tiers[0].id);

      const plans = await tx.insert(schema.subscriptionPlans).values([
        { tierId: testTierIds[0], price: 9900, durationDays: 30 },
      ]).returning();
      testPlanIds.push(plans[0].id);
    });
  });

  afterAll(async () => {
    // 생성된 테스트 데이터 정리
    if (dbService) {
      if(currentSubscriptionId) {
        await dbService.db.delete(schema.subscriptionRights).where(eq(schema.subscriptionRights.subscriptionId, currentSubscriptionId));
        await dbService.db.delete(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.subscriptionId, currentSubscriptionId));
      }
      await dbService.db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, testUserId));
      if (testPlanIds.length > 0) await dbService.db.delete(schema.subscriptionPlans).where(inArray(schema.subscriptionPlans.id, testPlanIds));
      if (testTierIds.length > 0) await dbService.db.delete(schema.subscriptionTiers).where(inArray(schema.subscriptionTiers.id, testTierIds));
      await dbService.db.delete(schema.users).where(eq(schema.users.id, testUserId));
    }
    await app.close();
  });

  describe('시나리오: 신규 사용자의 구독/조회/취소', () => {
    it('Step 1: 사용자가 성공적으로 플랜을 구독한다', async () => {
        // API 호출로 구독 생성 (성공 여부는 201 상태 코드로만 확인)
        await request(app.getHttpServer())
            .post('/subscriptions').query({ userId: testUserId }).send({ planId: testPlanIds[0] }).expect(201);

        // [핵심 해결책] API 응답 대신 DB를 직접 조회하여 생성된 구독 정보를 가져온다.
        const subscription = await dbService.db.query.subscriptions.findFirst({
            where: eq(schema.subscriptions.userId, testUserId),
        });

        // 생성된 구독이 DB에 실제로 존재하는지, planId가 올바른지 확인
        expect(subscription).toBeDefined();
        expect(subscription?.planId).toBe(testPlanIds[0]);
        
        // 다음 테스트를 위해 구독 ID 저장
        currentSubscriptionId = subscription!.id;
    });

    it('Step 2: 구독 후, 현재 구독 정보를 정확히 조회할 수 있다', async () => {
        const response = await request(app.getHttpServer())
            .get('/subscriptions/current').query({ userId: testUserId }).expect(200);
        expect(response.body.id).toBe(currentSubscriptionId);
    });

    it('Step 3: 구독을 성공적으로 취소할 수 있다', async () => {
        await request(app.getHttpServer())
            .post('/subscriptions/cancel').query({ userId: testUserId }).send({ reason: 'E2E 테스트 완료' }).expect(200);
        
        // DB 직접 검증
        const sub = await dbService.db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, currentSubscriptionId!) });
        expect(sub?.status).toMatch(/CANCELLED|PENDING_CANCELLATION/);
    });
  });
});