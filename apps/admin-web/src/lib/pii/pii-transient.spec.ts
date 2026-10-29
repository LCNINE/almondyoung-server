import { QueryClient } from '@tanstack/react-query';
import { client } from '../api/client';
import { CustomError } from '../api/customError';
import { transientPiiError, type PiiMeta } from './pii-notices';

const meta = (reason: PiiMeta['reason']): PiiMeta => ({
  maskedKinds: ['name'],
  reason,
  redactedPaths: [],
  revealable: false,
});

describe('transientPiiError', () => {
  it('일시 장애로 가려진 GET 은 안내 문장을 돌려준다', () => {
    expect(transientPiiError(meta('unavailable'), 'get')).toEqual(
      expect.any(String)
    );
    expect(transientPiiError(meta('record-failed'), 'GET')).toEqual(
      expect.any(String)
    );
    expect(transientPiiError(meta('unavailable'), undefined)).toEqual(
      expect.any(String)
    );
  });

  it('쓰기 응답은 오류로 바꾸지 않는다', () => {
    expect(transientPiiError(meta('record-failed'), 'patch')).toBeNull();
    expect(transientPiiError(meta('unavailable'), 'post')).toBeNull();
  });

  it('권한 부족·열람 필요·가림 없음은 오류가 아니다', () => {
    expect(transientPiiError(meta('no-permission'), 'get')).toBeNull();
    expect(transientPiiError(meta('reveal-required'), 'get')).toBeNull();
    expect(transientPiiError(null, 'get')).toBeNull();
  });
});

describe('일시 장애 오류와 react-query', () => {
  const failure = () =>
    new CustomError({
      message: transientPiiError(meta('unavailable'), 'get') ?? '',
      statusCode: 503,
    });

  it('오류로 끝나고 데이터를 남기지 않는다', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await qc
      .fetchQuery({ queryKey: ['a'], queryFn: () => Promise.reject(failure()) })
      .catch(() => undefined);
    const state = qc.getQueryState(['a']);
    expect(state?.status).toBe('error');
    expect(state?.data).toBeUndefined();
  });

  it('원문으로 성공한 뒤 다시 불러 실패해도 이전 원문이 남는다', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const raw = { name: '홍길동' };
    await qc.fetchQuery({
      queryKey: ['b'],
      queryFn: () => Promise.resolve(raw),
      staleTime: 0,
    });
    await qc
      .fetchQuery({
        queryKey: ['b'],
        queryFn: () => Promise.reject(failure()),
        staleTime: 0,
      })
      .catch(() => undefined);
    const state = qc.getQueryState(['b']);
    expect(state?.status).toBe('error');
    expect(state?.data).toBe(raw);
  });
});

describe('응답 인터셉터', () => {
  const respond = (method: string, reason: string) =>
    client.request({
      url: '/x',
      method,
      adapter: async (config) => ({
        data: { name: '***' },
        status: 200,
        statusText: 'OK',
        headers: { 'x-pii-masked': 'name', 'x-pii-mask-reason': reason },
        config,
      }),
    });

  it('일시 장애로 가려진 GET 은 503 으로 거절한다', async () => {
    await expect(respond('get', 'unavailable')).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('같은 응답이라도 PATCH 는 그대로 통과한다', async () => {
    await expect(respond('patch', 'record-failed')).resolves.toMatchObject({
      data: { name: '***' },
    });
  });

  it('권한 부족으로 가려진 GET 은 그대로 통과한다', async () => {
    await expect(respond('get', 'no-permission')).resolves.toMatchObject({
      status: 200,
    });
  });
});
