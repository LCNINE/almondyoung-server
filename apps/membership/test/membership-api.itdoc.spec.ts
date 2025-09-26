import { describeAPI, itDoc, field, HttpMethod, HttpStatus } from 'itdoc';

// 간단한 MockDate 구현
class MockDate {
  private static originalDate = Date;
  private static mockDate: Date | null = null;

  static set(date: Date) {
    this.mockDate = date;
    const originalDateConstructor = this.originalDate;
    const mockDateTime = date.getTime();

    global.Date = class extends originalDateConstructor {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDateTime);
        } else {
          super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
        }
      }

      static now() {
        return mockDateTime;
      }
    } as any;
  }

  static reset() {
    global.Date = this.originalDate;
    this.mockDate = null;
  }
}

// 테스트 데이터
const TEST_USER_ID = 'test_user_001';
const TEST_ADMIN_ID = 'admin_001';

// 생성된 리소스 ID들
let standardTierId: string;
let monthlyPlanId: string;
let subscriptionContractId: string;

// =============================================================================
// 1. 관리자 API - 티어 관리
// =============================================================================

describeAPI(
  HttpMethod.POST,
  '/admin/tiers',
  {
    summary: '구독 티어 생성',
    tag: 'Admin - Tier Management',
    description: '새로운 구독 티어를 생성합니다 (관리자 전용)',
  },
  global.__APP__,
  (apiDoc) => {
    let mockedDate = new Date('2023-10-01T00:00:00Z');

    beforeEach(() => {
      MockDate.set(mockedDate);
    });

    afterEach(() => {
      MockDate.reset();
    });

    itDoc('STANDARD 티어 생성 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .header({
          'x-user-id': field('관리자 사용자 ID', TEST_ADMIN_ID) as any,
        })
        .body({
          code: field('티어 코드 (대문자)', 'STANDARD'),
          priorityLevel: field('우선순위 레벨 (1-100)', 1),
        })
        .res()
        .status(HttpStatus.CREATED)
        .body({
          success: field('성공 여부', true),
          data: field('생성된 티어 정보', {
            tierId: 'tier-standard-123',
          }),
          meta: field('메타 정보', {
            action: 'create_tier',
            adminId: TEST_ADMIN_ID,
            tierCode: 'STANDARD',
            processedAt: '2023-10-01T00:00:00.000Z',
          }),
        });
    });
  },
);

describeAPI(
  HttpMethod.POST,
  '/admin/plans',
  {
    summary: '구독 플랜 생성',
    tag: 'Admin - Plan Management',
    description: '티어에 대한 새로운 구독 플랜을 생성합니다 (관리자 전용)',
  },
  global.__APP__,
  (apiDoc) => {
    let mockedDate = new Date('2023-10-01T00:00:00Z');

    beforeEach(() => {
      MockDate.set(mockedDate);
    });

    afterEach(() => {
      MockDate.reset();
    });

    itDoc('월간 플랜 생성 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .header({
          'x-user-id': field('관리자 사용자 ID', TEST_ADMIN_ID) as any,
        })
        .body({
          tierId: field('티어 ID', 'tier-standard-123'),
          price: field('플랜 가격', 10000),
          durationDays: field('플랜 기간 (일)', 30),
          currency: field('통화 코드', 'KRW'),
          trialDays: field('무료 체험 기간 (일)', 7),
        })
        .res()
        .status(HttpStatus.CREATED)
        .body({
          success: field('성공 여부', true),
          data: field('생성된 플랜 정보', {
            planId: 'plan-monthly-123',
          }),
          meta: field('메타 정보', {
            action: 'create_plan',
            adminId: TEST_ADMIN_ID,
            tierId: 'tier-standard-123',
            processedAt: '2023-10-01T00:00:00.000Z',
          }),
        });
    });
  },
);

// =============================================================================
// 2. 공개 API - 플랜/티어 조회 (인증 불필요)
// =============================================================================

describeAPI(
  HttpMethod.GET,
  '/plans',
  {
    summary: '모든 활성 플랜 조회',
    tag: 'Plan Management',
    description: '모든 활성 구독 플랜을 조회합니다',
  },
  global.__APP__,
  (apiDoc) => {
    itDoc('활성 플랜 목록 조회 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('활성 플랜 목록', [
            {
              plan: {
                id: field('플랜 ID', 'plan-monthly-123'),
                tierId: field('티어 ID', 'tier-standard-123'),
                price: field('가격', 10000),
                durationDays: field('기간(일)', 30),
                currency: field('통화', 'KRW'),
                trialDays: field('체험기간(일)', 7),
                isActive: field('활성상태', true),
                createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
                updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
              },
              tier: {
                id: field('티어 ID', 'tier-standard-123'),
                code: field('티어 코드', 'STANDARD'),
                priorityLevel: field('우선순위', 1),
                createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
                updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
              },
            },
          ]),
          count: field('플랜 개수', 1),
          meta: field('메타 정보', {
            retrievedAt: '2023-10-01T00:00:00.000Z',
            source: 'plan_list_query',
          }),
        });
    });
  },
);

describeAPI(
  HttpMethod.GET,
  '/tiers',
  {
    summary: '모든 티어 조회',
    tag: 'Plan Management',
    description: '모든 구독 티어를 조회합니다',
  },
  global.__APP__,
  (apiDoc) => {
    itDoc('티어 목록 조회 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('티어 목록', [
            {
              id: field('티어 ID', 'tier-standard-123'),
              code: field('티어 코드', 'STANDARD'),
              priorityLevel: field('우선순위', 1),
              createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
              updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
            },
          ]),
          count: field('티어 개수', 1),
          meta: field('메타 정보', {
            retrievedAt: '2023-10-01T00:00:00.000Z',
            source: 'tier_list_query',
          }),
        });
    });
  },
);

// =============================================================================
// 3. 사용자 구독 API
// =============================================================================

describeAPI(
  HttpMethod.POST,
  '/subscriptions',
  {
    summary: '구독 생성',
    tag: 'Subscription Management',
    description: '사용자의 새로운 구독을 생성합니다',
  },
  global.__APP__,
  (apiDoc) => {
    let mockedDate = new Date('2023-10-01T00:00:00Z');

    beforeEach(() => {
      MockDate.set(mockedDate);
    });

    afterEach(() => {
      MockDate.reset();
    });

    itDoc('구독 생성 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .header({
          'x-user-id': field('사용자 ID', TEST_USER_ID) as any,
        })
        .body({
          planId: field('플랜 ID', 'plan-monthly-123'),
        })
        .res()
        .status(HttpStatus.CREATED)
        .body({
          success: field('성공 여부', true),
          data: field('구독 생성 결과', {
            contractId: 'contract-123',
            entitlementId: 'entitlement-123',
          }),
          meta: field('메타 정보', {
            action: 'create_subscription',
            userId: TEST_USER_ID,
            planId: 'plan-monthly-123',
            processedAt: '2023-10-01T00:00:00.000Z',
          }),
        });
    });
  },
);

describeAPI(
  HttpMethod.GET,
  '/subscriptions/current',
  {
    summary: '현재 구독 조회',
    tag: 'Subscription Management',
    description: '사용자의 현재 활성 구독을 조회합니다',
  },
  global.__APP__,
  (apiDoc) => {
    itDoc('구독이 없는 사용자는 null 반환', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .queryParam({
          userId: field('구독 없는 사용자', 'no-subscription-user'),
        })
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('구독 정보', null),
          meta: field('메타 정보', {
            userId: 'no-subscription-user',
            retrievedAt: '2023-10-01T00:00:00.000Z',
            source: 'current_subscription_query',
          }),
        });
    });

    itDoc('현재 구독 조회 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .queryParam({
          userId: field('사용자 ID', TEST_USER_ID),
        })
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('구독 정보', {
            entitlement: {
              id: field('권한 ID', 'entitlement-123'),
              userId: field('사용자 ID', TEST_USER_ID),
              tierId: field('티어 ID', 'tier-standard-123'),
              startsAt: field('시작일', '2023-10-01'),
              endsAt: field('종료일', '2023-11-07'),
              isCurrent: field('현재 활성', true),
              pausedAt: field('일시정지일', null),
              createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
              updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
            },
            contract: {
              id: field('계약 ID', 'contract-123'),
              userId: field('사용자 ID', TEST_USER_ID),
              planId: field('플랜 ID', 'plan-monthly-123'),
              nextBillingDate: field('다음 결제일', '2023-10-08'),
              isVoided: field('무효 여부', false),
              createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
              updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
            },
            plan: {
              id: field('플랜 ID', 'plan-monthly-123'),
              tierId: field('티어 ID', 'tier-standard-123'),
              price: field('가격', 10000),
              durationDays: field('기간(일)', 30),
              currency: field('통화', 'KRW'),
              trialDays: field('체험기간(일)', 7),
              isActive: field('활성상태', true),
              createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
              updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
            },
            tier: {
              id: field('티어 ID', 'tier-standard-123'),
              code: field('티어 코드', 'STANDARD'),
              priorityLevel: field('우선순위', 1),
              createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
              updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
            },
          }),
          meta: field('메타 정보', {
            userId: TEST_USER_ID,
            retrievedAt: '2023-10-01T00:00:00.000Z',
            source: 'current_subscription_query',
          }),
        });
    });
  },
);

// =============================================================================
// 4. 일시정지 API
// =============================================================================

describeAPI(
  HttpMethod.POST,
  '/pause',
  {
    summary: '구독 일시정지',
    tag: 'Pause Management',
    description: '사용자의 구독을 일시정지합니다',
  },
  global.__APP__,
  (apiDoc) => {
    let mockedDate = new Date('2023-10-01T00:00:00Z');

    beforeEach(() => {
      MockDate.set(mockedDate);
    });

    afterEach(() => {
      MockDate.reset();
    });

    itDoc('구독 일시정지 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .header({
          'x-user-id': field('사용자 ID', TEST_USER_ID) as any,
        })
        .body({
          startDate: field('시작일', '2023-10-15T00:00:00Z'),
          endDate: field('종료일', '2023-10-22T00:00:00Z'),
          reason: field('사유', '휴가'),
        })
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('일시정지 결과', {
            id: field('이벤트 ID', 'pause-event-123'),
            userId: field('사용자 ID', TEST_USER_ID),
            entitlementId: field('권한 ID', 'entitlement-123'),
            eventType: field('이벤트 타입', 'START'),
            effectiveAt: field('효력 발생일', '2023-10-01T00:00:00.000Z'),
            reason: field('사유', '휴가'),
            createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
            updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
          }),
          meta: field('메타 정보', {
            action: 'pause_subscription',
            userId: TEST_USER_ID,
            processedAt: '2023-10-01T00:00:00.000Z',
          }),
        });
    });
  },
);

describeAPI(
  HttpMethod.POST,
  '/pause/resume',
  {
    summary: '구독 재개',
    tag: 'Pause Management',
    description: '일시정지된 구독을 재개합니다',
  },
  global.__APP__,
  (apiDoc) => {
    let mockedDate = new Date('2023-10-01T00:00:00Z');

    beforeEach(() => {
      MockDate.set(mockedDate);
    });

    afterEach(() => {
      MockDate.reset();
    });

    itDoc('구독 재개 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .header({
          'x-user-id': field('사용자 ID', TEST_USER_ID) as any,
        })
        .body({
          reason: field('사유', '휴가 종료'),
        })
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('재개 결과', {
            id: field('이벤트 ID', 'resume-event-123'),
            userId: field('사용자 ID', TEST_USER_ID),
            entitlementId: field('권한 ID', 'entitlement-123'),
            eventType: field('이벤트 타입', 'RESUME'),
            effectiveAt: field('효력 발생일', '2023-10-01T00:00:00.000Z'),
            reason: field('사유', 'User resumed subscription'),
            createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
            updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
          }),
          meta: field('메타 정보', {
            action: 'resume_subscription',
            userId: TEST_USER_ID,
            processedAt: '2023-10-01T00:00:00.000Z',
          }),
        });
    });
  },
);

// =============================================================================
// 5. 관리자 권한 관리 API
// =============================================================================

describeAPI(
  HttpMethod.POST,
  '/admin/entitlements/adjust',
  {
    summary: '사용자 구독 기간 조정',
    tag: 'Admin - Entitlement Management',
    description: '관리자가 사용자의 구독 기간을 연장하거나 차감합니다',
  },
  global.__APP__,
  (apiDoc) => {
    let mockedDate = new Date('2023-10-01T00:00:00Z');

    beforeEach(() => {
      MockDate.set(mockedDate);
    });

    afterEach(() => {
      MockDate.reset();
    });

    itDoc('구독 기간 연장 성공', async () => {
      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .header({
          'x-user-id': field('관리자 ID', TEST_ADMIN_ID) as any,
        })
        .body({
          userId: field('대상 사용자 ID', TEST_USER_ID),
          days: field('연장 일수', 7),
          reason: field('연장 사유', '고객 서비스 보상'),
        })
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('조정 결과', {
            id: field('권한 ID', 'entitlement-extended-123'),
            userId: field('사용자 ID', TEST_USER_ID),
            tierId: field('티어 ID', 'tier-standard-123'),
            startsAt: field('시작일', '2023-10-01'),
            endsAt: field('종료일', '2023-11-14'),
            isCurrent: field('현재 활성', true),
            pausedAt: field('일시정지일', null),
            createdAt: field('생성일', '2023-10-01T00:00:00.000Z'),
            updatedAt: field('수정일', '2023-10-01T00:00:00.000Z'),
          }),
          meta: field('메타 정보', {
            action: 'adjust_entitlement',
            adminId: TEST_ADMIN_ID,
            userId: TEST_USER_ID,
            processedAt: '2023-10-01T00:00:00.000Z',
          }),
        });
    });
  },
);
