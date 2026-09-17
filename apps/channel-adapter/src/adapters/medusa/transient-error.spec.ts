import { isTransientMedusaError } from './transient-error';
import { SlowRetryInboxError } from './slow-retry.error';

describe('isTransientMedusaError', () => {
  it('Medusa 재기동 공백의 502/503 을 일시 장애로 본다', () => {
    expect(isTransientMedusaError({ status: 502, message: 'Bad Gateway' })).toBe(true);
    expect(isTransientMedusaError({ status: 503, message: 'Service Temporarily Unavailable' })).toBe(true);
  });

  it('medusa.client 가 감싼 에러도 cause 를 따라가 찾는다', () => {
    const wrapped = new Error('Medusa findProductByHandle failed: Bad Gateway', {
      cause: { status: 502, message: 'Bad Gateway' },
    });
    expect(isTransientMedusaError(wrapped)).toBe(true);
  });

  it('연결이 맺히지 못한 경우도 일시 장애다', () => {
    expect(isTransientMedusaError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('4xx 는 요청이 틀린 것이라 재시도 대상이 아니다', () => {
    expect(isTransientMedusaError({ status: 404 })).toBe(false);
    expect(isTransientMedusaError({ status: 409 })).toBe(false);
  });

  it('문구만 5xx 처럼 생긴 것은 걸리지 않는다', () => {
    expect(isTransientMedusaError(new Error('Bad Gateway'))).toBe(false);
  });

  it('cause 가 순환해도 멈춘다', () => {
    const a: Record<string, unknown> = {};
    a.cause = a;
    expect(isTransientMedusaError(a)).toBe(false);
  });

  it('SlowRetryInboxError 와는 독립이다 (워커가 OR 로 합친다)', () => {
    expect(isTransientMedusaError(new SlowRetryInboxError('customer not found'))).toBe(false);
  });
});
