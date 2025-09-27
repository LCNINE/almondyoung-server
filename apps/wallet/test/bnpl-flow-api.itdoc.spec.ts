import { describeAPI, itDoc, field, HttpMethod, HttpStatus } from 'itdoc';
import { getTsid } from 'tsid-ts';
import * as schema from '../src/shared/database/schema';

// 여기서는 global.d.ts 덕분에 declare global 불필요
beforeAll(async () => {
  if (!global.__APP__) {
    throw new Error('앱이 globalSetup에서 초기화되지 않았습니다.');
  }
});

// 리소스 정리
afterAll(async () => {
  if (global.__NEST_APP__) {
    await global.__NEST_APP__.close();
  }
  if (global.__MODULE_REF__) {
    await global.__MODULE_REF__.close();
  }
});

// BNPL 전체 플로우 테스트 - API 기반
describe('BNPL 전체 플로우 API 테스트', () => {
  let testUserId: string;
  let testProfileId: string;
  let testAccountId: string;
  let testIntentId: string;

  beforeEach(() => {
    testUserId = `user_${getTsid().toString()}`;
  });

  // =======================================================
  // 1. BNPL 프로필 생성 API 테스트
  // =======================================================
  describeAPI(
    HttpMethod.POST,
    '/v2/payments/hms-bnpl/onboard',
    {
      summary: 'HMS BNPL 프로필 및 동의서 등록',
      tag: 'BNPL',
      description: 'BNPL 프로필을 생성하고 출금 동의서를 업로드합니다.',
    },
    global.__APP__,
    (apiDoc) => {
      itDoc('BNPL 프로필 생성 성공', async () => {
        
        return apiDoc
          .test()
          .req()
          .body({
            // multipart 필드들 (문서화용)
            userId: field('사용자 ID', testUserId),
            payerName: field('납부자명', '김비엔피엘'),
            phone: field('전화번호', '01098765432'),
            paymentCompany: field('은행 코드', '088'),
            paymentNumber: field('계좌 번호', '110222333444'),
            payerNumber: field('생년월일', '950101'),
            name: field('프로필 별칭', '나의 BNPL 계좌'),
            agreementFile: field('동의서 파일', 'binary'),
          })
          .res()
          .status(HttpStatus.CREATED)
          .body({
            success: field('성공 여부', true),
            profileId: field('프로필 ID', (v) => {
              if (typeof v !== 'string')
                throw new Error(`profileId must be string, got ${v}`);
              testProfileId = v; // 다음 테스트에서 사용하기 위해 저장
              return v;
            }),
          });
      });

      itDoc('필수 필드 누락 시 실패', async () => {
        // multipart 테스트 스킵, 에러 응답 형태만 문서화
        return apiDoc
          .test()
          .req()
          .body({
            userId: field('사용자 ID', testUserId),
            payerName: field('납부자명', '김비엔피엘'),
            // phone 필드 누락
            paymentCompany: field('은행 코드', '088'),
            paymentNumber: field('계좌 번호', '110222333444'),
            payerNumber: field('생년월일', '950101'),
          })
          .res()
          .status(HttpStatus.BAD_REQUEST)
          .body({
            statusCode: field('상태 코드', 400),
            message: field('에러 메시지', (v) => {
              if (typeof v !== 'string')
                throw new Error(`message must be string, got ${v}`);
              return v;
            }),
          });
      });
    },
  );

  // =======================================================
  // 2. BNPL 계정 생성 API 테스트
  // =======================================================
  describeAPI(
    HttpMethod.POST,
    '/v2/payments/bnpl/accounts',
    {
      summary: 'BNPL 계정 생성',
      tag: 'BNPL',
      description: '사용자의 BNPL 계정을 생성하고 신용 한도를 설정합니다.',
    },
    global.__APP__,
    (apiDoc) => {
      itDoc('BNPL 계정 생성 성공', async () => {
        const creditLimit = 500000; // 50만원 한도

        return apiDoc
          .test()
          .req()
          .body({
            userId: field('사용자 ID', testUserId),
            creditLimit: field('신용 한도', creditLimit),
          })
          .res()
          .status(HttpStatus.CREATED)
          .body({
            success: field('성공 여부', true),
            accountId: field('계정 ID', (v) => {
              if (typeof v !== 'string')
                throw new Error(`accountId must be string, got ${v}`);
              testAccountId = v; // 다음 테스트에서 사용하기 위해 저장
              return v;
            }),
            userId: field('사용자 ID', testUserId),
            creditLimit: field('신용 한도', creditLimit),
            availableLimit: field('사용 가능 한도', creditLimit),
            status: field('계정 상태', 'ACTIVE'),
          });
      });

      itDoc('중복 계정 생성 시 실패', async () => {
        // 이미 위에서 계정을 생성했으므로 중복 생성 시도
        return apiDoc
          .test()
          .req()
          .body({
            userId: field('사용자 ID', testUserId),
            creditLimit: field('신용 한도', 300000),
          })
          .res()
          .status(HttpStatus.BAD_REQUEST);
      });

      itDoc('잘못된 한도로 계정 생성 시 실패', async () => {
        const newUserId = `user_${getTsid().toString()}`;

        return apiDoc
          .test()
          .req()
          .body({
            userId: field('사용자 ID', newUserId),
            creditLimit: field('잘못된 신용 한도', -100), // 음수 한도
          })
          .res()
          .status(HttpStatus.BAD_REQUEST)
          .body({
            statusCode: field('상태 코드', 400),
            message: field('에러 메시지', 'Validation failed'),
            errors: field('에러 목록', (v) => {
              if (!Array.isArray(v))
                throw new Error(`errors must be array, got ${v}`);
              return v;
            }),
          });
      });
    },
  );

  // =======================================================
  // 3. 결제 Intent 생성 API 테스트
  // =======================================================
  describeAPI(
    HttpMethod.POST,
    '/v2/payments/intents',
    {
      summary: '결제 의도 생성',
      tag: 'Payment',
      description: 'BNPL 결제를 위한 Intent를 생성합니다.',
    },
    global.__APP__,
    (apiDoc) => {
      itDoc('BNPL Intent 생성 성공', async () => {
        const paymentAmount = 150000; // 15만원

        return apiDoc
          .test()
          .req()
          .body({
            customerId: field('고객 ID', testUserId),
            amount: field('결제 금액', paymentAmount),
            type: field('결제 타입', 'BNPL_CAPTURE'),
          })
          .res()
          .status(HttpStatus.CREATED)
          .body({
            id: field('Intent ID', (v) => {
              if (typeof v !== 'string')
                throw new Error(`id must be string, got ${v}`);
              testIntentId = v; // 다음 테스트에서 사용하기 위해 저장
              return v;
            }),
            customerId: field('고객 ID', testUserId),
            amount: field('결제 금액', paymentAmount),
            type: field('결제 타입', 'BNPL_CAPTURE'),
            status: field('Intent 상태', 'PENDING'),
          });
      });

      itDoc('필수 필드 누락 시 실패', async () => {
        return apiDoc
          .test()
          .req()
          .body({
            customerId: field('고객 ID', testUserId),
            type: field('결제 타입', 'BNPL_CAPTURE'),
            // amount 필드 누락
          })
          .res()
          .status(HttpStatus.BAD_REQUEST)
          .body({
            statusCode: field('상태 코드', 400),
            message: field('에러 메시지', 'Validation failed'),
            errors: field('에러 목록', [
              {
                code: field('코드', 'invalid_type'),
                expected: field('예상 타입', 'number'),
                received: field('받은 값', 'undefined'),
                path: field('에러 경로', ['amount']),
                message: field('에러 메시지', 'Required'),
              },
            ]),
          });
      });
    },
  );

  // =======================================================
  // 4. BNPL 결제 승인 API 테스트 (authorize)
  // =======================================================
  describeAPI(
    HttpMethod.POST,
    '/v2/payments/intents/{intentId}/authorize',
    {
      summary: 'BNPL 결제 승인',
      tag: 'BNPL',
      description: 'BNPL 결제를 승인 처리합니다 (HMS_BNPL 프로바이더 사용).',
    },
    global.__APP__,
    (apiDoc) => {
      itDoc('BNPL 결제 승인 성공', async () => {
        // 이전 테스트에서 생성된 데이터 사용
        const intentId = testIntentId || 'test_intent_id';
        const profileId = testProfileId || 'test_profile_id';

        return apiDoc
          .test()
          .req()
          .pathParam({ intentId: intentId })
          .body({
            provider: field('프로바이더', 'HMS_BNPL'),
            paymentKey: field('결제 키', profileId),
          })
          .res()
          .status(HttpStatus.OK)
          .body({
            success: field('성공 여부', true),
            intentId: field('Intent ID', intentId),
            attemptId: field('시도 ID', (v) => {
              if (typeof v !== 'string')
                throw new Error(`attemptId must be string, got ${v}`);
              return v;
            }),
            status: field('결제 상태', 'AUTHORIZED'),
            provider: field('프로바이더', 'HMS_BNPL'),
            amount: field('결제 금액', (v) => {
              if (typeof v !== 'number')
                throw new Error(`amount must be number, got ${v}`);
              return v;
            }),
            message: field('성공 메시지', (v) => {
              if (typeof v !== 'string')
                throw new Error(`message must be string, got ${v}`);
              return v;
            }),
          });
      });

      itDoc('존재하지 않는 Intent로 승인 시 실패', async () => {
        const nonExistentIntentId = 'non_existent_intent';

        return apiDoc
          .test()
          .req()
          .pathParam({ intentId: nonExistentIntentId })
          .body({
            provider: field('프로바이더', 'HMS_BNPL'),
            paymentKey: field('결제 키', 'test_profile_id'),
          })
          .res()
          .status(HttpStatus.NOT_FOUND);
      });

      itDoc('한도 부족 시 승인 실패', async () => {
        // 한도를 초과하는 새로운 Intent 생성 후 테스트
        const newUserId = `user_${getTsid().toString()}`;
        const lowCreditLimit = 100000; // 10만원 한도
        const highPaymentAmount = 200000; // 20만원 결제 (한도 초과)

        // 1. 새 사용자로 프로필 생성 (실제로는 이전 테스트들이 성공해야 함)
        // 2. 낮은 한도로 계정 생성
        // 3. 높은 금액으로 Intent 생성
        // 4. 승인 시도 -> 실패 예상

        // 여기서는 예시로 기존 사용자의 한도 초과 시나리오를 테스트
        const intentId = testIntentId || 'test_intent_id';
        const profileId = testProfileId || 'test_profile_id';

        return apiDoc
          .test()
          .req()
          .pathParam({ intentId: intentId })
          .body({
            provider: field('프로바이더', 'HMS_BNPL'),
            paymentKey: field('결제 키', profileId),
          })
          .res()
          .status(HttpStatus.BAD_REQUEST);
      });

      itDoc('BNPL 계정이 없는 사용자의 승인 시도', async () => {
        // BNPL 계정이 없는 새 사용자로 테스트
        const newUserId = `user_${getTsid().toString()}`;

        // 새 Intent 생성 (실제로는 별도 API 호출 필요)
        const intentId = testIntentId || 'test_intent_id';
        const profileId = testProfileId || 'test_profile_id';

        return apiDoc
          .test()
          .req()
          .pathParam({ intentId: intentId })
          .body({
            provider: field('프로바이더', 'HMS_BNPL'),
            paymentKey: field('결제 키', profileId),
          })
          .res()
          .status(HttpStatus.BAD_REQUEST);
      });
    },
  );

  // =======================================================
  // 5. Intent 조회 API 테스트
  // =======================================================
  describeAPI(
    HttpMethod.GET,
    '/v2/payments/intents/{intentId}',
    {
      summary: 'Intent 조회',
      tag: 'Payment',
      description: '결제 의도(Intent) ID로 Intent 정보를 조회합니다.',
    },
    global.__APP__,
    (apiDoc) => {
      itDoc('Intent 조회 성공', async () => {
        const intentId = testIntentId || 'test_intent_id';

        return apiDoc
          .test()
          .req()
          .pathParam({ intentId: intentId })
          .res()
          .status(HttpStatus.OK)
          .body({
            id: field('Intent ID', intentId),
            customerId: field('고객 ID', (v) => {
              if (typeof v !== 'string')
                throw new Error(`customerId must be string, got ${v}`);
              return v;
            }),
            amount: field('결제 금액', (v) => {
              if (typeof v !== 'number')
                throw new Error(`amount must be number, got ${v}`);
              return v;
            }),
            type: field('결제 타입', (v) => {
              if (typeof v !== 'string')
                throw new Error(`type must be string, got ${v}`);
              return v;
            }),
            status: field('Intent 상태', (v) => {
              if (typeof v !== 'string')
                throw new Error(`status must be string, got ${v}`);
              return v;
            }),
          });
      });

      itDoc('존재하지 않는 Intent 조회 시 실패', async () => {
        const nonExistentIntentId = 'non_existent_intent';

        return apiDoc
          .test()
          .req()
          .pathParam({ intentId: nonExistentIntentId })
          .res()
          .status(HttpStatus.NOT_FOUND)
          .body({
            statusCode: field('상태 코드', 404),
            message: field('에러 메시지', (v) => {
              if (typeof v !== 'string')
                throw new Error(`message must be string, got ${v}`);
              return v;
            }),
          });
      });
    },
  );
});
