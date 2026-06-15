import { CmsApiClient } from './cms-api.client';

const TEST_ENV = {
  HYOSUNG_CMS_API_URL: 'https://api-test.hyosungcms.co.kr',
  HYOSUNG_CMS_ADD_URL: 'https://add-test.hyosungcms.co.kr',
  HYOSUNG_CMS_SW_KEY: 'test-sw',
  HYOSUNG_CMS_CUST_KEY: 'test-cust',
  HYOSUNG_CMS_CUST_ID: 'testcustid',
};

let originalEnv: Record<string, string | undefined>;

beforeAll(() => {
  originalEnv = Object.fromEntries(Object.keys(TEST_ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, TEST_ENV);
});

afterAll(() => {
  Object.assign(process.env, originalEnv);
});

function mockFetch(status: number, body?: unknown): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Response);
}

describe('CmsApiClient', () => {
  let client: CmsApiClient;

  beforeEach(() => {
    client = new CmsApiClient();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('인증 헤더', () => {
    it('Authorization: VAN {swKey}:{custKey} 형식으로 전송한다', async () => {
      const spy = mockFetch(200, { member: { memberId: 'M1', status: '신청대기', result: {} } });

      await client.getMember('M1');

      const [, options] = spy.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('VAN test-sw:test-cust');
      expect(headers['X-SW-KEY']).toBeUndefined();
      expect(headers['X-CUST-KEY']).toBeUndefined();
    });
  });

  describe('URL 경로', () => {
    it('회원조회: GET /v1/members/{memberId}', async () => {
      const spy = mockFetch(200, { member: { memberId: 'M1', status: '신청완료', result: {} } });

      await client.getMember('M1');

      const [url] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api-test.hyosungcms.co.kr/v1/members/M1');
    });

    it('회원등록: POST /v1/members', async () => {
      const spy = mockFetch(201, { member: { memberId: 'M1', status: '신청대기', result: {} } });

      await client.createMember({
        memberId: 'M1',
        memberName: '홍길동',
        phone: '01012345678',
        paymentKind: 'CMS',
        paymentCompany: '088',
        paymentNumber: '1234567890',
        payerName: '홍길동',
        payerNumber: '900101',
      });

      const [url, options] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api-test.hyosungcms.co.kr/v1/members');
      expect((options as RequestInit).method).toBe('POST');
    });

    it('회원수정: PUT /v1/members/{memberId}', async () => {
      const spy = mockFetch(200, { member: { memberId: 'M1', status: '신청대기', result: {} } });

      await client.updateMember('M1', {
        paymentKind: 'CMS',
        phone: '01012345678',
        paymentCompany: '004',
        paymentNumber: '9999',
        payerName: '홍길동',
        payerNumber: '900101',
      });

      const [url, options] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api-test.hyosungcms.co.kr/v1/members/M1');
      expect((options as RequestInit).method).toBe('PUT');
    });

    it('회원삭제: DELETE /v1/members/{memberId} — 바디 없음', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
        status: 204,
        ok: true,
        json: async () => {
          throw new Error('no body');
        },
      } as unknown as Response);

      await client.deleteMember('M1');

      const [url, options] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api-test.hyosungcms.co.kr/v1/members/M1');
      expect((options as RequestInit).method).toBe('DELETE');
      expect((options as RequestInit).body).toBeUndefined();
    });

    it('출금신청: POST /v1/payments/cms', async () => {
      const spy = mockFetch(201, { payment: { transactionId: 'T1', status: '출금대기', result: {} } });

      await client.requestWithdrawal({
        transactionId: 'T1',
        memberId: 'M1',
        paymentDate: '20260601',
        callAmount: 10000,
      });

      const [url] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api-test.hyosungcms.co.kr/v1/payments/cms');
    });

    it('동의자료 조회: GET /v1/custs/{custId}/agreements/{key}', async () => {
      const spy = mockFetch(200, { agreementFile: { agreementKey: 'KEY1', registerStatus: '등록', result: {} } });

      await client.getAgreement('KEY1');

      const [url] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://add-test.hyosungcms.co.kr/v1/custs/testcustid/agreements/KEY1');
    });

    it('동의자료 API는 custId가 없으면 빈 /custs// URL을 호출하지 않고 설정 오류를 던진다', async () => {
      const previous = process.env.HYOSUNG_CMS_CUST_ID;
      delete process.env.HYOSUNG_CMS_CUST_ID;
      const spy = jest.spyOn(global, 'fetch');

      await expect(client.getAgreement('KEY1')).rejects.toMatchObject({
        code: 'CMS_PROVIDER_CONFIG_MISSING',
        providerMessage: 'HYOSUNG_CMS_CUST_ID is not configured',
      });
      expect(spy).not.toHaveBeenCalled();

      process.env.HYOSUNG_CMS_CUST_ID = previous;
    });
  });

  describe('Request 바디', () => {
    it('createMember 바디에 swKey/custKey 없고 스펙 필드(paymentNumber, paymentKind) 있음', async () => {
      const spy = mockFetch(201, { member: { memberId: 'M1', status: '신청대기', result: {} } });

      await client.createMember({
        memberId: 'M1',
        memberName: '홍길동',
        phone: '01012345678',
        paymentKind: 'CMS',
        paymentCompany: '088',
        paymentNumber: '1234567890',
        payerName: '홍길동',
        payerNumber: '900101',
      });

      const [, options] = spy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.swKey).toBeUndefined();
      expect(body.custKey).toBeUndefined();
      expect(body.bankAccount).toBeUndefined();
      expect(body.paymentNumber).toBe('1234567890');
      expect(body.phone).toBe('01012345678');
      expect(body.paymentKind).toBe('CMS');
      expect(body.memberId).toBe('M1');
    });

    it('requestWithdrawal 바디에 callAmount 필드 사용 (amount 아님)', async () => {
      const spy = mockFetch(201, { payment: { transactionId: 'T1', status: '출금대기', result: {} } });

      await client.requestWithdrawal({
        transactionId: 'T1',
        memberId: 'M1',
        paymentDate: '20260601',
        callAmount: 10000,
      });

      const [, options] = spy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.callAmount).toBe(10000);
      expect(body.amount).toBeUndefined();
    });
  });

  describe('응답 파싱', () => {
    it('HTTP 2xx 성공 시 { member: {...} } 래퍼를 그대로 반환한다', async () => {
      mockFetch(200, {
        member: { memberId: 'M1', status: '신청완료', result: { flag: 'Y', code: 'Q000', message: '정상' } },
      });

      const result = await client.getMember('M1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.member.memberId).toBe('M1');
        expect(result.data.member.status).toBe('신청완료');
        expect(result.data.member.result?.code).toBe('Q000');
      }
    });

    it('HTTP 204 No Content는 성공으로 처리한다', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        status: 204,
        ok: true,
        json: async () => {
          throw new Error('no body');
        },
      } as unknown as Response);

      const result = await client.deleteMember('M1');
      expect(result.ok).toBe(true);
    });

    it('HTTP 400 에러 시 body.error.message를 사용한다', async () => {
      mockFetch(400, { error: { message: '잘못된 요청', developerMessage: '필드 오류' } });

      const result = await client.getMember('M1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.statusCode).toBe(400);
        expect(result.error.message).toBe('잘못된 요청');
      }
    });

    it('효성 인증 실패 메시지는 운영 설정 오류 코드로 분류한다', async () => {
      mockFetch(400, { code: '400', message: '인증 실패. 인증정보를 확인해주세요.' });

      const result = await client.createMember({
        memberId: 'M1',
        memberName: '홍길동',
        phone: '01012345678',
        paymentKind: 'CMS',
        paymentCompany: '088',
        paymentNumber: '1234567890',
        payerName: '홍길동',
        payerNumber: '900101',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.statusCode).toBe(400);
        expect(result.error.code).toBe('CMS_PROVIDER_AUTH_FAILED');
      }
    });

    it('body에 resultCode 없어도 HTTP ok 기반으로 성공 판별한다', async () => {
      // 구버전(body.resultCode === '0000')이었다면 이 케이스에서 실패했을 것
      mockFetch(200, { member: { memberId: 'M1', status: '신청완료', result: {} } });

      const result = await client.getMember('M1');
      expect(result.ok).toBe(true);
    });

    it('출금조회 응답의 payment.status를 올바르게 접근할 수 있다', async () => {
      mockFetch(200, {
        payment: {
          transactionId: 'T1',
          status: '출금성공',
          callAmount: 10000,
          actualAmount: 10000,
          fee: 250,
          result: { flag: 'Y', code: 'Q000', message: '정상' },
        },
      });

      const result = await client.getWithdrawal('T1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.payment.status).toBe('출금성공');
        expect(result.data.payment.result?.code).toBe('Q000');
        expect(result.data.payment.actualAmount).toBe(10000);
      }
    });
  });

  describe('출금 검색 파라미터', () => {
    it('fromPaymentDate/toPaymentDate/pageSize/pageNumber 를 쿼리스트링으로 구성한다', async () => {
      const spy = mockFetch(200, { totalCnt: 0, payments: [] });

      await client.searchWithdrawals({
        fromPaymentDate: '20260101',
        toPaymentDate: '20260131',
        pageSize: 10,
        pageNumber: 1,
      });

      const [url] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('fromPaymentDate=20260101');
      expect(url).toContain('toPaymentDate=20260131');
      expect(url).toContain('pageSize=10');
      expect(url).toContain('pageNumber=1');
      expect(url).not.toContain('startDate');
      expect(url).not.toContain('endDate');
      expect(url).not.toContain('swKey');
      expect(url).not.toContain('custKey');
    });
  });
});
