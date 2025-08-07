import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { v4 as uuidv4 } from 'uuid';

describe('Membership Subscription E2E Test', () => {
  let app: INestApplication;

  // 테스트 전반에 걸쳐 사용될 변수들
  const adminId = uuidv4();
  const userId = uuidv4();
  let tierId: string;
  let planId: string;
  let policyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ===================================================================
  // 📝 1단계: 관리자 사전 설정 (Admin Setup)
  // ===================================================================
  describe('Phase 1: Admin Setup', () => {
    it('1-1. [POST /admin/tiers] should create a new tier', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/tiers')
        .set('x-user-id', adminId) // DevAuthGuard를 위한 관리자 ID
        .send({ code: 'STANDARD', rank: 10 })
        .expect(201);

      expect(response.body.tierId).toBeDefined();
      tierId = response.body.tierId; // 다음 테스트를 위해 tierId 저장
    });

    it('1-2. [POST /admin/plans] should create a new plan', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/plans')
        .set('x-user-id', adminId)
        .send({
          tierId: tierId, // 이전 단계에서 생성된 tierId 사용
          price: 10000,
          durationDays: 30,
          trialDays: 7,
        })
        .expect(201);

      expect(response.body.planId).toBeDefined();
      planId = response.body.planId; // 다음 테스트를 위해 planId 저장
    });

    it('1-3. [POST /admin/policies] should create a new policy', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/policies')
        .set('x-user-id', adminId)
        .send({
          ruleType: 'MAX_PAUSES_PER_YEAR',
          ruleValue: { limit: 2 },
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      policyId = response.body.id;
    });
  });

  // ===================================================================
  // 🚀 2단계: 사용자 구독 여정 (User Journey)
  // ===================================================================
  describe('Phase 2: User Journey', () => {
    let initialEndsAt: string;

    it('2-1. [POST /subscriptions] should create a new subscription', async () => {
      const response = await request(app.getHttpServer())
        .post('/subscriptions')
        .set('x-user-id', userId) // DevAuthGuard를 위한 사용자 ID
        .send({ planId: planId }) // 사전 설정에서 생성된 planId 사용
        .expect(201);

      expect(response.body.contractId).toBeDefined();
      expect(response.body.entitlementId).toBeDefined();
    });

    it('2-2. [GET /subscriptions/current] should get current subscription status', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userId)
        .expect(200);

      expect(response.body.tier.code).toEqual('STANDARD');
      expect(response.body.plan.id).toEqual(planId);
      expect(response.body.isPaused).toBe(false);

      // 구독 종료일이 약 37일 후인지 확인 (duration 30일 + trial 7일)
      const endsAt = new Date(response.body.entitlement.endsAt);
      const expectedEndsAt = new Date();
      expectedEndsAt.setDate(expectedEndsAt.getDate() + 37);

      expect(endsAt.getDate()).toBe(expectedEndsAt.getDate());
      initialEndsAt = response.body.entitlement.endsAt; // 재개 테스트를 위해 저장
    });

    it('2-3. [POST /subscriptions/pause] should pause the subscription', async () => {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + 10);

      const response = await request(app.getHttpServer())
        .post('/subscriptions/pause')
        .set('x-user-id', userId)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        })
        .expect(200);

      expect(response.body.pauseId).toBeDefined();
      expect(response.body.pausedAt).toBeDefined();
    });

    it('2-4. [GET /subscriptions/pause/history] should get pause history', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/pause/history')
        .set('x-user-id', userId)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(1);
      expect(response.body[0].userId).toEqual(userId);
    });

    it('2-5. [POST /subscriptions/resume] should resume the subscription', async () => {
      // 재개 시점을 시뮬레이션하기 위해 잠시 대기 (예: 1초)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await request(app.getHttpServer())
        .post('/subscriptions/resume')
        .set('x-user-id', userId)
        .send({})
        .expect(200);

      expect(response.body.resumedAt).toBeDefined();
      expect(response.body.newEndsAt).toBeDefined();

      // 종료일이 연장되었는지 확인
      const newEndsAt = new Date(response.body.newEndsAt);
      const oldEndsAt = new Date(initialEndsAt);
      expect(newEndsAt.getTime()).toBeGreaterThan(oldEndsAt.getTime());
    });

    it('2-6. [POST /subscriptions/cancel] should cancel the subscription', async () => {
      const response = await request(app.getHttpServer())
        .post('/subscriptions/cancel')
        .set('x-user-id', userId)
        .send({ reason: 'E2E Test Cancellation' })
        .expect(200);

      expect(response.body.cancelledAt).toBeDefined();
      expect(response.body.contractId).toBeDefined();
    });

    it('2-7. [GET /subscriptions/history] should get subscription history', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/history')
        .set('x-user-id', userId)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].isVoided).toBe(true); // 가장 최신 이력이 취소된 계약이어야 함
    });
  });
});
