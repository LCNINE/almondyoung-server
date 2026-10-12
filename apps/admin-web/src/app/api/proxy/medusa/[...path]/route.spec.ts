import type { NextRequest } from 'next/server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { DELETE, GET, POST } from './route';

jest.mock('@/lib/auth/get-token-payload', () => ({
  getTokenPayload: jest.fn(),
}));

const mockedGetTokenPayload = getTokenPayload as jest.MockedFunction<
  typeof getTokenPayload
>;

function request(method = 'GET') {
  return {
    method,
    nextUrl: { search: '' },
    headers: new Headers({ 'content-type': 'application/json' }),
    cookies: { get: () => undefined },
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ path: ['admin', 'promotions'] }) };

function payload(roles: string[]) {
  return {
    sub: 'user-1',
    roles,
    email: 'a@example.com',
    login_id: 'a',
    must_change_password: false,
  };
}

describe('Medusa admin proxy', () => {
  let transport: jest.SpyInstance;

  beforeEach(() => {
    transport = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockedGetTokenPayload.mockReset();
  });

  it('rejects requests without a valid admin session before reaching Medusa', async () => {
    mockedGetTokenPayload.mockResolvedValue(null);

    expect((await GET(request(), params)).status).toBe(401);
    expect((await POST(request('POST'), params)).status).toBe(401);
    expect((await DELETE(request('DELETE'), params)).status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects signed-in users without a staff role', async () => {
    mockedGetTokenPayload.mockResolvedValue(payload(['user', 'membership']));

    expect((await GET(request(), params)).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed when token verification is not configured', async () => {
    mockedGetTokenPayload.mockRejectedValue(new Error('OIDC env missing'));

    expect((await GET(request(), params)).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([['admin'], ['master']])(
    'forwards requests from %s',
    async (role) => {
      mockedGetTokenPayload.mockResolvedValue(payload([role]));

      expect((await GET(request(), params)).status).toBe(200);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(String(transport.mock.calls[0][0])).toContain('/admin/promotions');
    }
  );
});
