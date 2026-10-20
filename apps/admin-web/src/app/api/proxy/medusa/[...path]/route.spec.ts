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
  return { state: 'ready', roles: [], permissions: new Set(permissions), version: 'v1', landingPath: null, fetchedAt: 0 };
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

  describe('개인정보 응답', () => {
    const orderBody = { order: { id: 'order_1', email: 'abcd@x.com', shipping_address: { phone: '010-1234-5678' } } };
    const medusaJson = () => new Response(JSON.stringify(orderBody), { status: 200, headers: { 'Content-Type': 'application/json' } });

    beforeEach(() => {
      process.env.USER_SERVICE_URL = 'http://user';
    });

    it('records through user-service and returns the raw order to a viewer with customer.pii.read', async () => {
      mockedGetMyPermissions.mockResolvedValue(ready('order.order.read', 'customer.pii.read'));
      transport.mockImplementation(async (url: unknown) =>
        String(url).startsWith('http://user') ? new Response(null, { status: 204 }) : medusaJson(),
      );

      const res = await GET(request(), paramsFor('admin', 'orders', 'order_1'));
      expect(await res.json()).toEqual(orderBody);
      expect(res.headers.get('x-pii-masked')).toBe('none');
      const recordCall = transport.mock.calls.find(([url]) => String(url) === 'http://user/iam/pii-access-logs');
      expect(recordCall).toBeDefined();
      expect(JSON.parse(String(recordCall?.[1]?.body))).toMatchObject({ route: 'admin/orders/:id', subjectCount: 1 });
    });

    it('masks the order for a viewer without customer.pii.read and records nothing', async () => {
      mockedGetMyPermissions.mockResolvedValue(ready('order.order.read'));
      transport.mockImplementation(async () => medusaJson());

      const res = await GET(request(), paramsFor('admin', 'orders', 'order_1'));
      const body = await res.json();
      expect(body.order.email).toBe('ab***@x.com');
      expect(res.headers.get('x-pii-mask-reason')).toBe('no-permission');
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('masks when the access log cannot be written', async () => {
      mockedGetMyPermissions.mockResolvedValue(ready('order.order.read', 'customer.pii.read'));
      transport.mockImplementation(async (url: unknown) =>
        String(url).startsWith('http://user') ? new Response('down', { status: 500 }) : medusaJson(),
      );

      const res = await GET(request(), paramsFor('admin', 'orders', 'order_1'));
      expect((await res.json()).order.email).toBe('ab***@x.com');
      expect(res.headers.get('x-pii-mask-reason')).toBe('record-failed');
    });

    it('masks a created (201) customer address for a viewer without customer.pii.read', async () => {
      mockedGetMyPermissions.mockResolvedValue(ready('customer.profile.write'));
      transport.mockResolvedValue(
        new Response(JSON.stringify({ customer: { id: 'cus_1', addresses: [{ address_1: '서울특별시 송파구 중대로 135', phone: '010-1234-5678' }] } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const res = await POST(request('POST'), paramsFor('admin', 'customers', 'cus_1', 'addresses'));
      expect(res.status).toBe(201);
      expect((await res.json()).customer.addresses[0].phone).toBe('010-****-5678');
      expect(res.headers.get('x-pii-mask-reason')).toBe('no-permission');
    });

    it('leaves non-personal Medusa responses byte for byte', async () => {
      mockedGetMyPermissions.mockResolvedValue(ready('marketing.promotion.read'));
      transport.mockResolvedValue(new Response('{"promotions":[{"id":"p1","email":"x"}]}', { status: 200, headers: { 'Content-Type': 'application/json' } }));

      const res = await GET(request(), params);
      expect(await res.text()).toBe('{"promotions":[{"id":"p1","email":"x"}]}');
      expect(res.headers.get('x-pii-masked')).toBeNull();
    });
  });
});
