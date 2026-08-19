import { of } from 'rxjs';
import { NaverOrderClient } from './naver-order.client';

describe('NaverOrderClient.getLastChangedStatuses', () => {
  const http = { get: jest.fn() } as any;
  const auth = { getAccessToken: jest.fn().mockResolvedValue('token') } as any;
  const client = new NaverOrderClient(http, auth);

  beforeEach(() => {
    jest.clearAllMocks();
    http.get.mockReturnValue(of({ data: { timestamp: '', traceId: 't', data: { count: 0, lastChangeStatuses: [] } } }));
  });

  it('조회 창의 끝을 명시해 보낸다', async () => {
    await client.getLastChangedStatuses({
      lastChangedFrom: '2026-08-19T00:00:00.000+09:00',
      lastChangedTo: '2026-08-19T06:00:00.000+09:00',
    });

    const [, config] = http.get.mock.calls[0];
    expect(config.params.lastChangedTo).toBe('2026-08-19T06:00:00.000+09:00');
    expect(config.params.limitCount).toBe(300);
  });

  it('moreSequence 를 넘기면 그대로 실어 보낸다', async () => {
    await client.getLastChangedStatuses({
      lastChangedFrom: '2026-08-19T02:00:00.000+09:00',
      moreSequence: '17',
    });

    const [, config] = http.get.mock.calls[0];
    expect(config.params.moreSequence).toBe('17');
  });

  it('moreSequence 가 없으면 파라미터를 아예 넣지 않는다', async () => {
    await client.getLastChangedStatuses({ lastChangedFrom: '2026-08-19T02:00:00.000+09:00' });

    const [, config] = http.get.mock.calls[0];
    expect('moreSequence' in config.params).toBe(false);
  });
});
