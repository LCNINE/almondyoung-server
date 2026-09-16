import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { GET } from './route';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('@/lib/auth/get-token-payload', () => ({
  getTokenPayload: jest.fn(),
}));
const request = () =>
  new NextRequest('https://admin.almondyoung-next.com/demo/guide/index.html');
const params = (path = ['index.html']) => ({
  params: Promise.resolve({ path }),
});
describe('authenticated demo guide files', () => {
  const original = process.env;
  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...original,
      APP_STAGE: 'demo',
      DEMO_CONSOLE_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_MODE: 'mock',
    };
    jest
      .mocked(getTokenPayload)
      .mockResolvedValue({
        sub: 'employee',
        must_change_password: false,
      } as never);
    jest.mocked(readFile).mockResolvedValue(Buffer.from('<html>guide</html>'));
  });
  afterEach(() => {
    process.env = original;
  });
  it('never serves files outside demo even with feature flags', async () => {
    process.env.APP_STAGE = 'live';
    expect((await GET(request(), params())).status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });
  it('requires verified authentication for HTML and PDF assets', async () => {
    jest.mocked(getTokenPayload).mockResolvedValue(null);
    for (const path of [['index.html'], ['output', 'pdf', 'retail.pdf']]) {
      const response = await GET(request(), params(path));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain(
        '/auth/ensure?redirect_to='
      );
    }
    expect(readFile).not.toHaveBeenCalled();
  });
  it.each([
    ['..', 'secret.pdf'],
    ['.env'],
    ['scripts', 'render.py'],
    ['a/b.html'],
  ])(
    'rejects paths outside the reviewed artifact scope %j',
    async (...path) => {
      expect((await GET(request(), params(path))).status).toBe(404);
      expect(readFile).not.toHaveBeenCalled();
    }
  );
  it('serves authorized files privately with their correct MIME type', async () => {
    const response = await GET(
      request(),
      params(['output', 'pdf', 'retail.pdf'])
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(readFile).toHaveBeenCalledWith(
      expect.stringMatching(/demo-guides\/output\/pdf\/retail\.pdf$/)
    );
  });
});
