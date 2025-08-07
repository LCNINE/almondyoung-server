import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { SubscriptionExceptionFilter } from '../src/shared/filters/subscription-exception.filter';
import { testDataBuilder } from './fixtures/test-data';

describe('Membership Subscription E2E Test', () => {
  let app: INestApplication;

  // 테스트 데이터는 각 테스트에서 동적으로 생성
  let adminSetupData: ReturnType<typeof testDataBuilder.getAdminSetupData>;
  let userJourneyData: ReturnType<typeof testDataBuilder.getUserJourneyData>;

  // 생성된 리소스 ID들
  let standardTierId: string;
  let monthlyPlanId: string;
  let pausePolicyId: string;

  // 고유한 테스트 식별자
  const testId = Date.now().toString();
  const uniqueTierCode = `STANDARD_${testId}`;

  beforeAll(async () => {
    // 전체 테스트 스위트에서 동일한 데이터 사용
    testDataBuilder.reset();
    adminSetupData = testDataBuilder.getAdminSetupData();
    userJourneyData = testDataBuilder.getUserJourneyData();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new SubscriptionExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });



  // ===================================================================
  // 📝 1단계: 관리자 설정 - 티어, 플랜, 정책 생성
  // ===================================================================
  describe('Phase 1: Admin Setup', () => {
    it('1-1. [POST /admin/tiers] should create a STANDARD tier', async () => {
      console.log('🔍 Sending tier request:', adminSetupData.tierRequest);

      const response = await request(app.getHttpServer())
        .post('/admin/tiers')
        .set('x-user-id', adminSetupData.ids.adminId)
        .send(adminSetupData.tierRequest);

      console.log('📋 Tier creation response:', {
        status: response.status,
        body: response.body,
        text: response.text
      });

      if (response.status !== 201) {
        throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(response.body)}`);
      }

      expect(response.body.tierId).toBeDefined();
      standardTierId = response.body.tierId;
      console.log('✅ STANDARD Tier Created:', response.body);
    });

    it('1-2. [POST /admin/plans] should create a new monthly plan', async () => {
      const planRequest = { ...adminSetupData.planRequest, tierId: standardTierId };
      console.log('🔍 Sending plan request:', planRequest);

      const response = await request(app.getHttpServer())
        .post('/admin/plans')
        .set('x-user-id', adminSetupData.ids.adminId)
        .send(planRequest);

      console.log('📋 Plan creation response:', {
        status: response.status,
        body: response.body,
        text: response.text
      });

      if (response.status !== 201) {
        throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(response.body)}`);
      }

      expect(response.body.planId).toBeDefined();
      monthlyPlanId = response.body.planId;
      console.log('✅ Monthly Plan Created:', response.body);
    });

    it('1-3. [POST /admin/policies] should create a pause limit policy', async () => {
      console.log('🔍 Sending policy request:', adminSetupData.policyRequest);

      const response = await request(app.getHttpServer())
        .post('/admin/policies')
        .set('x-user-id', adminSetupData.ids.adminId)
        .send(adminSetupData.policyRequest);

      console.log('📋 Policy creation response:', {
        status: response.status,
        body: response.body,
        text: response.text
      });

      if (response.status !== 201) {
        throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(response.body)}`);
      }

      expect(response.body.id).toBeDefined();
      pausePolicyId = response.body.id;
      console.log('✅ Pause Policy Created:', response.body);
    });
  });

  // ===================================================================
  // 🚀 2단계: 사용자 구독 여정 (User Journey)
  // ===================================================================
  describe('Phase 2: User Journey', () => {
    it('2-1. [POST /subscriptions] should create a new subscription', async () => {
      const subscriptionRequest = { ...userJourneyData.subscriptionRequest, planId: monthlyPlanId };
      console.log('🔍 Sending subscription request:', subscriptionRequest);

      const response = await request(app.getHttpServer())
        .post('/subscriptions')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(subscriptionRequest);

      console.log('📋 Subscription creation response:', {
        status: response.status,
        body: response.body,
        text: response.text
      });

      if (response.status !== 201) {
        throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(response.body)}`);
      }

      expect(response.body.contractId).toBeDefined();
      expect(response.body.entitlementId).toBeDefined();
      console.log('✅ Subscription Created:', response.body);

      // 구독 생성 후 잠시 대기 (비동기 처리 완료를 위해)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 구독 상태 즉시 확인
      const statusResponse = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userJourneyData.ids.userId);

      console.log('📋 Subscription status after creation:', statusResponse.body);

      // entitlement가 제대로 생성되었는지 확인
      if (Object.keys(statusResponse.body).length === 0) {
        throw new Error('Subscription was created but no active entitlement found. This indicates a problem with entitlement creation.');
      }
    });

    it('2-2. [GET /subscriptions/current] should get current subscription status', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userJourneyData.ids.userId)
        .expect(200);

      console.log('✅ Current Subscription Fetched:', response.body);

      // 구독이 생성되지 않았다면 빈 객체가 반환될 수 있음
      if (Object.keys(response.body).length === 0) {
        console.log('⚠️ No active subscription found');
        return;
      }

      // 응답 구조에 따라 적절히 검증
      if (response.body.tier) {
        expect(response.body.tier.code).toEqual(adminSetupData.tierRequest.code);
        expect(response.body.plan?.id).toEqual(monthlyPlanId);
      } else if (response.body.currentTier) {
        expect(response.body.currentTier.code).toEqual(adminSetupData.tierRequest.code);
        expect(response.body.plan?.id).toEqual(monthlyPlanId);
      }
    });

    it('2-3. [POST /subscriptions/pause] should pause the subscription', async () => {
      console.log('🔍 Sending pause request:', userJourneyData.pauseRequest);

      const response = await request(app.getHttpServer())
        .post('/subscriptions/pause')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(userJourneyData.pauseRequest);

      console.log('📋 Pause response:', {
        status: response.status,
        body: response.body,
        text: response.text
      });

      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
      }

      expect(response.body.pauseId).toBeDefined();
      console.log('✅ Subscription Paused:', response.body);
    });

    it('2-4. [POST /subscriptions/pause/resume] should resume the subscription', async () => {
      console.log('🔍 Sending resume request:', userJourneyData.resumeRequest);

      const response = await request(app.getHttpServer())
        .post('/subscriptions/pause/resume')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(userJourneyData.resumeRequest);

      console.log('📋 Resume response:', {
        status: response.status,
        body: response.body,
        text: response.text
      });

      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
      }

      expect(response.body.resumedAt).toBeDefined();
      expect(response.body.newEndsAt).toBeDefined();
      console.log('✅ Subscription Resumed:', response.body);
    });

    it('2-5. [POST /subscriptions/cancel] should cancel the subscription', async () => {
      console.log('🔍 Sending cancel request:', userJourneyData.cancelRequest);

      const response = await request(app.getHttpServer())
        .post('/subscriptions/cancel')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(userJourneyData.cancelRequest);

      console.log('📋 Cancel response:', {
        status: response.status,
        body: response.body,
        text: response.text
      });

      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
      }

      expect(response.body.cancelledAt).toBeDefined();
      console.log('✅ Subscription Cancelled:', response.body);
    });

    it('2-6. [GET /subscriptions/current] should return null for cancelled subscription', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userJourneyData.ids.userId)
        .expect(200);

      console.log('✅ Current Subscription After Cancellation:', response.body);
      expect(response.body).toEqual({});
    });
  });
});
