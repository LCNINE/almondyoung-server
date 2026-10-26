import { CoreEligibilityUnavailable } from '../../../workflows/orders/returns/core-return-eligibility';
import { ReturnRequestRejected } from '../../../workflows/orders/returns/plan-return-request';
import { ReturnOrderNotFound } from '../../../workflows/orders/returns/request-order-return';
import { sendReturnError } from '../return-error-response';

const fakeRes = () => {
  const res = { statusCode: 0, body: undefined as unknown } as any;
  res.status = (s: number) => {
    res.statusCode = s;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res;
};

describe('sendReturnError', () => {
  it('ReturnRequestRejected → 400 + reason', () => {
    const res = fakeRes();
    expect(sendReturnError(res, new ReturnRequestRejected('window_closed', '기한'))).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ type: 'not_allowed', code: 'return_rejected', reason: 'window_closed', message: '기한' });
  });

  it('ReturnOrderNotFound → 404 not_found', () => {
    const res = fakeRes();
    expect(sendReturnError(res, new ReturnOrderNotFound('없음'))).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ type: 'not_found', message: '없음' });
  });

  it('CoreEligibilityUnavailable → 502 core_unavailable', () => {
    const res = fakeRes();
    expect(sendReturnError(res, new CoreEligibilityUnavailable('core 응답 500'))).toBe(true);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ type: 'core_unavailable', message: 'core 응답 500' });
  });

  it('그 밖의 오류는 처리하지 않는다(false)', () => {
    const res = fakeRes();
    expect(sendReturnError(res, new Error('boom'))).toBe(false);
    expect(res.statusCode).toBe(0);
  });
});
