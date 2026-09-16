import type { NextRequest } from 'next/server';
import { GET, POST } from './route';

function request(
  method = 'GET',
  origin = 'https://admin.almondyoung-next.com',
  token = 'token'
) {
  return {
    method,
    nextUrl: { search: '', origin: 'https://admin.almondyoung-next.com' },
    headers: new Headers({ origin }),
    cookies: { get: () => (token ? { value: token } : undefined) },
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as NextRequest;
}
const params = (service: string, path: string[]) => ({
  params: Promise.resolve({ service, path }),
});
describe('demo console proxy', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = {
      ...original,
      APP_STAGE: 'demo',
      DEMO_CONSOLE_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_MODE: 'mock',
      CHANNEL_ADAPTER_SERVICE_URL:
        'https://channel-adapter.almondyoung-next.com',
    };
  });
  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });
  it('hides console APIs outside demo, including accidental enabled flag', async () => {
    process.env.APP_STAGE = 'live';
    expect((await GET(request(), params('channel', ['runs']))).status).toBe(
      404
    );
  });
  it('does not forward unauthenticated requests or cross-origin mutations', async () => {
    const transport = jest.spyOn(globalThis, 'fetch');
    expect(
      (await GET(request('GET', undefined, ''), params('channel', ['runs'])))
        .status
    ).toBe(401);
    expect(
      (
        await POST(
          request('POST', 'https://unrelated.example'),
          params('channel', ['runs'])
        )
      ).status
    ).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
  it('only forwards supported demo methods and preserves upstream authentication failure', async () => {
    const transport = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"message":"Forbidden"}', { status: 403 })
      );
    expect(
      (await POST(request('POST'), params('core', ['reset']))).status
    ).toBe(404);
    const response = await GET(request(), params('channel', ['runs']));
    expect(response.status).toBe(403);
    expect(transport.mock.calls[0][0]).toBe(
      'https://channel-adapter.almondyoung-next.com/demo/runs'
    );
    expect(
      (transport.mock.calls[0][1]?.headers as Headers).get('cookie')
    ).toContain('accessToken=token');
  });
});
