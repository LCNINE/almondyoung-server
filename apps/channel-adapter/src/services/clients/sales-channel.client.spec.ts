import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { SalesChannelClient } from './sales-channel.client';

const PIM_URL = 'http://core.test';
const INTERNAL_KEY = 'internal-key-value';

function configWith(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    PIM_API_URL: PIM_URL,
    CORE_INTERNAL_KEY: INTERNAL_KEY,
    ...overrides,
  };
  return { get: (name: string) => values[name] } as unknown as ConfigService;
}

describe('SalesChannelClient.getActiveSites', () => {
  it('core 의 내부 라우트를 부르고 사이트 목록을 돌려준다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { sites: ['medusa', 'naver'] } }));
    const client = new SalesChannelClient({ get } as unknown as HttpService, configWith());

    await expect(client.getActiveSites()).resolves.toEqual(['medusa', 'naver']);
    expect(get).toHaveBeenCalledWith(`${PIM_URL}/internal/channels/active-sites`, expect.anything());
  });

  it('내부 키를 Authorization 헤더에 싣는다 — 빠뜨리면 401 이고 게이트는 fail-closed 라 수집이 멈춘다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { sites: [] } }));
    const client = new SalesChannelClient({ get } as unknown as HttpService, configWith());

    await client.getActiveSites();

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: `Bearer ${INTERNAL_KEY}` } }),
    );
  });

  it('내부 키가 설정돼 있지 않으면 호출하지 않고 던진다', async () => {
    const get = jest.fn();
    const client = new SalesChannelClient(
      { get } as unknown as HttpService,
      configWith({ CORE_INTERNAL_KEY: undefined }),
    );

    await expect(client.getActiveSites()).rejects.toThrow(/CORE_INTERNAL_KEY/);
    expect(get).not.toHaveBeenCalled();
  });

  it('HTTP 실패를 삼키지 않고 던진다 — 활성 여부를 모르는 상태를 빈 목록으로 오해하면 안 된다', async () => {
    const get = jest.fn().mockReturnValue(throwError(() => new Error('connect ECONNREFUSED')));
    const client = new SalesChannelClient({ get } as unknown as HttpService, configWith());

    await expect(client.getActiveSites()).rejects.toThrow('connect ECONNREFUSED');
  });
});
