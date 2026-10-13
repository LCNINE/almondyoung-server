import type { NextRequest } from 'next/server';
import { getMyPermissions, type PermissionState } from '@/lib/auth/my-permissions.server';
import { DELETE, GET, POST } from './route';

jest.mock('@/lib/auth/my-permissions.server', () => ({
  getMyPermissions: jest.fn(),
}));

const mockedGetMyPermissions = getMyPermissions as jest.MockedFunction<typeof getMyPermissions>;

function request(method = 'GET') {
  return {
    method,
    nextUrl: { search: '' },
    headers: new Headers({ 'content-type': 'application/json' }),
    cookies: { get: () => undefined },
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as NextRequest;
}

const paramsFor = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const params = paramsFor('admin', 'promotions');

function ready(...permissions: string[]): PermissionState {
  return { state: 'ready', roles: [], permissions: new Set(permissions) };
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
    mockedGetMyPermissions.mockReset();
  });

  it('rejects requests without a valid admin session before reaching Medusa', async () => {
    mockedGetMyPermissions.mockResolvedValue({ state: 'unauthenticated' });

    expect((await GET(request(), params)).status).toBe(401);
    expect((await POST(request('POST'), params)).status).toBe(401);
    expect((await DELETE(request('DELETE'), paramsFor('admin', 'promotions', 'p1'))).status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects signed-in users without any permission (customers)', async () => {
    mockedGetMyPermissions.mockResolvedValue(ready());

    expect((await GET(request(), params)).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it('answers 503 when permissions cannot be decided yet', async () => {
    mockedGetMyPermissions.mockResolvedValue({ state: 'unavailable' });

    expect((await GET(request(), params)).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed when token verification is not configured', async () => {
    mockedGetMyPermissions.mockRejectedValue(new Error('OIDC env missing'));

    expect((await GET(request(), params)).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });

  it('lets a read permission read but not write', async () => {
    mockedGetMyPermissions.mockResolvedValue(ready('marketing.promotion.read'));

    expect((await GET(request(), params)).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toContain('/admin/promotions');

    const denied = await POST(request('POST'), params);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ requiredPermissions: ['marketing.promotion.write'] });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a Medusa path the admin screens never call', async () => {
    mockedGetMyPermissions.mockResolvedValue(ready('customer.profile.read', 'marketing.promotion.write'));

    expect((await GET(request(), paramsFor('admin', 'users'))).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    [['admin', 'promotions', '../regions']],
    [['admin', 'customers', '..', 'orders']],
    [['admin', 'promotions', '.']],
    [['admin', 'promotions', '']],
    [['admin', 'promotions', 'a\\..\\regions']],
    [['admin', 'promotions', '%2e%2e', 'regions']],
    [['admin', 'promotions', '%2e%2e']],
  ])('rejects a path segment that could change the forwarded path (%j)', async (path) => {
    mockedGetMyPermissions.mockResolvedValue(ready('marketing.promotion.write', 'customer.profile.read'));

    expect((await POST(request('POST'), paramsFor(...path))).status).toBe(403);
    expect((await GET(request(), paramsFor(...path))).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
});
