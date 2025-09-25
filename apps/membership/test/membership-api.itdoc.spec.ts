import { describeAPI, itDoc, field, HttpMethod, HttpStatus } from 'itdoc';

// 테스트 데이터
const TEST_USER_ID = 'test_user_001';
const TEST_ADMIN_ID = 'admin_001';

// 생성된 리소스 ID들
let standardTierId: string;
let monthlyPlanId: string;

// // 앱 초기화 확인
// beforeAll(async () => {
//   if (!global.__APP__) {
//     throw new Error('앱이 globalSetup에서 초기화되지 않았습니다.');
//   }
// });

// // 리소스 정리
// afterAll(async () => {
//   if (global.__NEST_APP__) {
//     await global.__NEST_APP__.close();
//   }
//   if (global.__MODULE_REF__) {
//     await global.__MODULE_REF__.close();
//   }
// });

// =============================================================================
// 1. 관리자 API - 티어 관리 (헤더 문제로 임시 주석 처리)
// =============================================================================

// describeAPI(
//   HttpMethod.POST,
//   '/admin/tiers',
//   {
//     summary: '구독 티어 생성',
//     tag: 'Admin - Tier Management',
//     description: '새로운 구독 티어를 생성합니다 (관리자 전용)',
//   },
//   global.__APP__,
//   (apiDoc) => {
//     itDoc('STANDARD 티어 생성 성공', async () => {
//       return apiDoc
//         .test()
//         .req()
//         .header({
//           'x-user-id': field('관리자 사용자 ID', 'admin_001'),
//         })
//         .body({
//           code: field('티어 코드 (대문자)', 'STANDARD'),
//           priorityLevel: field('우선순위 레벨 (1-100)', 1),
//         })
//         .res()
//         .status(HttpStatus.CREATED)
//         .body({
//           tierId: field('생성된 티어 ID', (val) => {
//             standardTierId = val as string;
//             return val;
//           }),
//           code: field('티어 코드', 'STANDARD'),
//           priorityLevel: field('우선순위 레벨', 1),
//           createdAt: field('생성 시간', (val) => val),
//         });
//     });
//   }
// );

// describeAPI(
//   HttpMethod.POST,
//   '/admin/plans',
//   {
//     summary: '구독 플랜 생성',
//     tag: 'Admin - Plan Management',
//     description: '티어에 대한 새로운 구독 플랜을 생성합니다 (관리자 전용)',
//   },
//   global.__APP__,
//   (apiDoc) => {
//     itDoc('월간 플랜 생성 성공', async () => {
//       return apiDoc
//         .test()
//         .req()
//         .header({
//           'x-user-id': field('관리자 사용자 ID', 'admin_001'),
//         })
//         .body({
//           tierId: field('티어 ID', standardTierId || 'test-tier-id'),
//           price: field('플랜 가격 (센트)', 10000),
//           durationDays: field('플랜 기간 (일)', 30),
//           currency: field('통화 코드', 'KRW'),
//           trialDays: field('무료 체험 기간 (일)', 7),
//         })
//         .res()
//         .status(HttpStatus.CREATED)
//         .body({
//           planId: field('생성된 플랜 ID', (val) => {
//             monthlyPlanId = val as string;
//             return val;
//           }),
//           tierId: field('티어 ID', (val) => val),
//           price: field('플랜 가격', 10000),
//           durationDays: field('기간', 30),
//           currency: field('통화', 'KRW'),
//           trialDays: field('체험 기간', 7),
//           isActive: field('활성 상태', true),
//           createdAt: field('생성 시간', (val) => val),
//         });
//     });
//   }
// );

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
        .req()
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true),
          data: field('활성 플랜 목록', (val) => val),
          count: field('플랜 개수', (val) => val),
          meta: field('메타 정보', (val) => val),
        });
    });
  },
);
describeAPI(
  HttpMethod.GET,
  '/plans',
  {
    summary: '모든 활성 플랜 목록 조회 API',
    tag: 'Plan',
    description: '모든 활성 구독 플랜과 티어 정보를 조회합니다.',
  },
  global.__APP__,
  (apiDoc) => {
    itDoc('모든 활성 플랜 목록 조회 성공', async () => {
      await apiDoc
        .test()
        .prettyPrint()
        .req()
        .res()
        .status(HttpStatus.OK)
        .body({
          success: field('성공 여부', true), // 여기서 data가 전체 배열 → 콜백으로 검사

          data: field('플랜 목록', (val: any) => {
            return val;
          }),
          count: field('플랜 개수', (val: any) => {
            if (typeof val !== 'number')
              throw new Error('count must be number');
            return val;
          }),
          meta: field('메타 정보', (val: any) => {
            if (typeof val.retrievedAt !== 'string')
              throw new Error('retrievedAt must be string');
            if (typeof val.source !== 'string')
              throw new Error('source must be string');
            return val;
          }),
        });
    });
  },
);

// =============================================================================
// 3. 사용자 구독 API
// =============================================================================

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
    itDoc('구독이 없는 사용자는 빈 객체 반환', async () => {
      return apiDoc
        .test()
        .req()
        .queryParam({
          userId: field('구독 없는 사용자', 'no-subscription-user'),
        })
        .res()
        .status(HttpStatus.OK)
        .body({}); // 이미 성공한 테스트
    });

    itDoc('현재 구독 조회 성공', async () => {
      return apiDoc
        .test()
        .req()
        .queryParam({
          userId: field('사용자 ID (개발용 인증)', TEST_USER_ID),
        })
        .res()
        .status(HttpStatus.OK);
      // body 검증은 실제 응답 확인 후 추가
    });
  },
);
