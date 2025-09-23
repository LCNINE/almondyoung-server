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

describeAPI(
  HttpMethod.POST,
  '/v2/payments/intents',
  {
    summary: '결제 의도 생성',
    tag: 'Payment',
    description: '결제를 위한 Intent를 생성합니다.',
  },
  global.__APP__,
  (apiDoc) => {
    itDoc('결제 의도 생성 성공', async () => {
      const customerId = getTsid().toString();

      return apiDoc
        .test()
        .req()
        .body({
          id: field('Intent ID', (v) => {
            // 여기서 원하는 검증 로직 작성 (예: 문자열인지 확인)
            if (typeof v !== 'string')
              throw new Error(`id must be string, got ${v}`);
            // 또는 정규식으로 uuid 확인도 가능
            // if (!/^[0-9a-zA-Z\-]+$/.test(v)) throw new Error(`Invalid id: ${v}`);
            return v; // ✅ 반드시 return
          }),
          customerId: field('고객 ID', customerId),
          amount: field('결제 금액', 150000),
          type: field('결제 타입', 'ORDER'),
        })
        .res()
        .status(HttpStatus.CREATED)
        .body({
          customerId: field('고객 ID', customerId),
          amount: field('결제 금액', 150000),
          type: field('결제 타입', 'ORDER'),
        });
    });

    itDoc('필수 필드 누락 시 실패', async () => {
      return apiDoc
        .test()
        .req()
        .body({
          customerId: field('고객 ID', 'user_123'),
          type: field('결제 타입', 'ORDER'),
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
