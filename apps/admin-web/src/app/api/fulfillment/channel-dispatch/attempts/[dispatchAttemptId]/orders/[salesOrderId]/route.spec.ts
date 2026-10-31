import { getTokenPayload, type TokenPayload } from '@/lib/auth/get-token-payload';
import { getMyPermissions, type PermissionState } from '@/lib/auth/my-permissions.server';
import { GET } from './route';

jest.mock('@/lib/auth/my-permissions.server', () => ({
  getMyPermissions: jest.fn(),
}));
jest.mock('@/lib/auth/get-token-payload', () => ({
  getTokenPayload: jest.fn(),
}));

const mockedGetMyPermissions = getMyPermissions as jest.MockedFunction<typeof getMyPermissions>;
const mockedGetTokenPayload = getTokenPayload as jest.MockedFunction<typeof getTokenPayload>;

const ATTEMPT = '0d4b9a52-6f0c-4c39-9a3e-3c1f7b2a9e10';
const ORDER = '7f1e2d3c-4b5a-4968-8776-655443322110';
const params = { params: Promise.resolve({ dispatchAttemptId: ATTEMPT, salesOrderId: ORDER }) };

function tokenOf(tenant: string | undefined): TokenPayload {
  return { sub: 'u1', roles: [], email: '', login_id: '', must_change_password: false, tenant };
}

const ready: PermissionState = {
  state: 'ready',
  roles: [],
  permissions: new Set(['fulfillment.shipment.read']),
  version: 'v1',
  landingPath: null,
  fetchedAt: 0,
};

describe('channel-dispatch 라우트 (channel-adapter 내부 키)', () => {
  let transport: jest.SpyInstance;

  beforeEach(() => {
    process.env.CHANNEL_ADAPTER_SERVICE_URL = 'http://channel-adapter';
    process.env.CHANNEL_ADAPTER_INTERNAL_KEY = 'internal-key';
    process.env.SERVER_CREDENTIAL_TENANT_ID = '1';
    process.env.TENANT_GATE_MODE = 'reject';
    mockedGetMyPermissions.mockResolvedValue(ready);
    transport = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ dispatchAttemptId: ATTEMPT, salesOrderId: ORDER, operations: [] }), { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockedGetMyPermissions.mockReset();
    mockedGetTokenPayload.mockReset();
  });

  it('테넌트 1 토큰이면 내부 키와 함께 테넌트 헤더(1)를 싣는다', async () => {
    mockedGetTokenPayload.mockResolvedValue(tokenOf('1'));

    const res = await GET(new Request('http://admin/x'), params);
    expect(res.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    const headers = new Headers(transport.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer internal-key');
    expect(headers.get('x-tenant-id')).toBe('1');
  });

  it('테넌트 2 토큰은 출고 조회 권한이 있어도 channel-adapter 에 닿지 않는다', async () => {
    mockedGetTokenPayload.mockResolvedValue(tokenOf('2'));

    const res = await GET(new Request('http://admin/x'), params);
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(transport).not.toHaveBeenCalled();
  });

  it('warn 에서 테넌트 없는 토큰은 통과하고 헤더에는 T 를 싣는다', async () => {
    process.env.TENANT_GATE_MODE = 'warn';
    mockedGetTokenPayload.mockResolvedValue(tokenOf(undefined));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect((await GET(new Request('http://admin/x'), params)).status).toBe(200);
    expect(new Headers(transport.mock.calls[0][1]?.headers).get('x-tenant-id')).toBe('1');
  });
});
