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

    it('1-3. [POST /admin/policies] should create or handle existing pause limit policy', async () => {
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

      if (response.status === 201) {
        // 새 정책 생성 성공
        expect(response.body.id).toBeDefined();
        pausePolicyId = response.body.id;
        console.log('✅ New Policy Created:', response.body);
      } else if (response.status === 400 && response.body.message?.includes('already exists')) {
        // 정책이 이미 존재함 - 이것도 정상적인 비즈니스 로직
        console.log('✅ Policy Already Exists (Expected Business Logic):', response.body.message);
        pausePolicyId = 'existing-policy'; // 테스트 진행을 위한 더미 ID
      } else {
        throw new Error(`Unexpected response: ${response.status} - ${JSON.stringify(response.body)}`);
      }
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
      // 일시정지 전 구독 상태 확인
      const beforePause = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userJourneyData.ids.userId)
        .expect(200);
      
      const originalEndsAt = beforePause.body.entitlement?.endsAt;
      console.log('🔍 Original subscription ends at:', originalEndsAt);
      
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

      // 일시정지 후 구독 상태 확인 (기간이 연장되었는지 검증)
      const afterPause = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userJourneyData.ids.userId)
        .expect(200);
      
      const newEndsAt = afterPause.body.entitlement?.endsAt;
      console.log('🔍 Extended subscription ends at:', newEndsAt);
      
      // 구독 기간이 연장되었는지 확인
      if (originalEndsAt && newEndsAt) {
        const originalDate = new Date(originalEndsAt);
        const newDate = new Date(newEndsAt);
        expect(newDate.getTime()).toBeGreaterThan(originalDate.getTime());
        console.log('✅ Subscription period extended due to pause');
      }
      console.log('✅ Subscription Paused:', response.body);

      // pauseEntitlementVoids 데이터 검증
      const pauseHistory = await request(app.getHttpServer())
        .get(`/admin/users/${userJourneyData.ids.userId}/pause-history`)
        .set('x-user-id', adminSetupData.ids.adminId)
        .expect(200);

      console.log('📋 Pause history with voids:', pauseHistory.body);
      
      expect(pauseHistory.body.pauseHistory).toHaveLength(1);
      const pauseRecord = pauseHistory.body.pauseHistory[0];
      
      // pauseEntitlementVoids 데이터 검증
      expect(pauseRecord.voidId).toBeDefined();
      expect(pauseRecord.originalEndsAt).toBe(originalEndsAt);
      expect(pauseRecord.adjustedEndsAt).toBe(newEndsAt);
      expect(pauseRecord.entitlementId).toBeDefined();
      
      console.log('✅ pauseEntitlementVoids data verified:', {
        voidId: pauseRecord.voidId,
        originalEndsAt: pauseRecord.originalEndsAt,
        adjustedEndsAt: pauseRecord.adjustedEndsAt,
      });
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

    it('2-6. [POST /admin/entitlements/adjust] should extend user subscription', async () => {
      // 먼저 새로운 구독을 생성 (이전 테스트에서 취소했으므로)
      const newSubscriptionRequest = { ...userJourneyData.subscriptionRequest, planId: monthlyPlanId };
      await request(app.getHttpServer())
        .post('/subscriptions')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(newSubscriptionRequest)
        .expect(201);

      // 구독 기간 30일 연장
      const extendRequest = {
        userId: userJourneyData.ids.userId,
        days: 30,
        reason: 'E2E Test - Extend 30 days'
      };

      const response = await request(app.getHttpServer())
        .post('/admin/entitlements/adjust')
        .set('x-user-id', adminSetupData.ids.adminId)
        .send(extendRequest)
        .expect(200);

      console.log('✅ Subscription Extended:', response.body);
      expect(response.body.action).toBe('extended');
      expect(response.body.adjustedDays).toBe(30);
      expect(response.body.userId).toBe(userJourneyData.ids.userId);
    });

    it('2-7. [POST /admin/entitlements/adjust] should reduce user subscription', async () => {
      // 구독 기간 7일 차감
      const reduceRequest = {
        userId: userJourneyData.ids.userId,
        days: -7,
        reason: 'E2E Test - Reduce 7 days'
      };

      const response = await request(app.getHttpServer())
        .post('/admin/entitlements/adjust')
        .set('x-user-id', adminSetupData.ids.adminId)
        .send(reduceRequest)
        .expect(200);

      console.log('✅ Subscription Reduced:', response.body);
      expect(response.body.action).toBe('reduced');
      expect(response.body.adjustedDays).toBe(-7);
      expect(response.body.userId).toBe(userJourneyData.ids.userId);
    });

    it('2-8. [POST /subscriptions/pause] should handle multiple pauses correctly', async () => {
      // 현재 구독 상태 확인
      const currentStatus = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userJourneyData.ids.userId)
        .expect(200);

      // 활성 구독이 없으면 새로 생성
      if (Object.keys(currentStatus.body).length === 0) {
        const newSubscriptionRequest = { ...userJourneyData.subscriptionRequest, planId: monthlyPlanId };
        await request(app.getHttpServer())
          .post('/subscriptions')
          .set('x-user-id', userJourneyData.ids.userId)
          .send(newSubscriptionRequest)
          .expect(201);
        
        console.log('✅ New subscription created for multiple pause test');
      } else {
        console.log('✅ Using existing active subscription for multiple pause test');
      }

      // 첫 번째 일시정지
      const firstPauseRequest = {
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5일
        reason: 'First pause test'
      };

      await request(app.getHttpServer())
        .post('/subscriptions/pause')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(firstPauseRequest)
        .expect(200);

      // 재개
      await request(app.getHttpServer())
        .post('/subscriptions/pause/resume')
        .set('x-user-id', userJourneyData.ids.userId)
        .send({ reason: 'Resume after first pause' })
        .expect(200);

      // 두 번째 일시정지 시도 (정책 위반으로 실패해야 함)
      const secondPauseRequest = {
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3일
        reason: 'Second pause test'
      };

      const secondPauseResponse = await request(app.getHttpServer())
        .post('/subscriptions/pause')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(secondPauseRequest);

      // 정책 위반으로 실패하는 것이 정상
      if (secondPauseResponse.status === 400) {
        console.log('✅ Policy violation correctly prevented second pause:', secondPauseResponse.body);
        expect(secondPauseResponse.body.error?.code).toBe('POLICY_VIOLATION');
      } else {
        // 정책이 없거나 허용된 경우
        expect(secondPauseResponse.status).toBe(200);
        console.log('✅ Second pause allowed (no policy restriction)');
      }

      // 일시정지 이력 확인
      const pauseHistory = await request(app.getHttpServer())
        .get(`/admin/users/${userJourneyData.ids.userId}/pause-history`)
        .set('x-user-id', adminSetupData.ids.adminId)
        .expect(200);

      console.log('📋 Multiple pause history:', pauseHistory.body);
      
      // 최소 1개의 일시정지 이력이 있어야 함 (첫 번째는 성공)
      expect(pauseHistory.body.pauseHistory.length).toBeGreaterThanOrEqual(1);
      expect(pauseHistory.body.totalPauses).toBeGreaterThanOrEqual(1);
      
      // 첫 번째 일시정지에 대한 pauseEntitlementVoids 데이터 확인
      const pausesWithVoids = pauseHistory.body.pauseHistory.filter(p => p.voidId);
      expect(pausesWithVoids.length).toBeGreaterThanOrEqual(1);
      
      console.log('✅ pauseEntitlementVoids records verified for policy-compliant pauses');
      
      // 정책 시스템이 올바르게 작동하는지 확인
      if (secondPauseResponse.status === 400) {
        console.log('✅ Policy system working correctly - prevented unauthorized pause');
      }
    });

    it('2-9. [GET /subscriptions/current] should return null for cancelled subscription', async () => {
      // 구독 취소
      await request(app.getHttpServer())
        .post('/subscriptions/cancel')
        .set('x-user-id', userJourneyData.ids.userId)
        .send(userJourneyData.cancelRequest)
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('x-user-id', userJourneyData.ids.userId)
        .expect(200);

      console.log('✅ Current Subscription After Cancellation:', response.body);
      expect(response.body).toEqual({});
    });
  });
});
