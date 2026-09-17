import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { GET } from './route';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('@/lib/auth/get-token-payload', () => ({
  getTokenPayload: jest.fn(),
}));

const request = (path = '/demo/guide/README.md') =>
  new NextRequest(`https://admin.almondyoung-next.com${path}`);
const params = (path: string[] = ['README.md']) => ({
  params: Promise.resolve({ path }),
});

describe('authenticated demo manuals', () => {
  const original = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...original,
      APP_STAGE: 'demo',
      DEMO_CONSOLE_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_MODE: 'mock',
    };
    jest.mocked(getTokenPayload).mockResolvedValue({
      sub: 'employee',
      must_change_password: false,
    } as never);
    jest.mocked(readFile).mockResolvedValue(Buffer.from('# Demo manual'));
  });

  afterEach(() => {
    process.env = original;
  });

  it('never serves manuals outside demo even with the feature flag', async () => {
    process.env.APP_STAGE = 'live';

    expect((await GET(request(), params())).status).toBe(404);
    expect(getTokenPayload).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated reader to login with the manual return path', async () => {
    jest.mocked(getTokenPayload).mockResolvedValue(null);

    const response = await GET(request(), params());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://admin.almondyoung-next.com/auth/ensure?redirect_to=%2Fdemo%2Fguide%2FREADME.md'
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('redirects a reader who must change their password before opening a manual', async () => {
    jest.mocked(getTokenPayload).mockResolvedValue({
      sub: 'employee',
      must_change_password: true,
    } as never);

    const response = await GET(
      request('/demo/guide/retail.md'),
      params(['retail.md'])
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://admin.almondyoung-next.com/account/change-password?redirect_to=%2Fdemo%2Fguide%2Fretail.md'
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('serves an allowlisted Markdown manual as private plain text', async () => {
    const response = await GET(
      request('/demo/guide/retail.md'),
      params(['retail.md'])
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8'
    );
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('# Demo manual');
    expect(readFile).toHaveBeenCalledWith(
      expect.stringMatching(/demo-guides\/retail\.md$/)
    );
  });

  it('downloads an allowlisted Markdown manual when download=1', async () => {
    const response = await GET(
      request('/demo/guide/operator.md?download=1'),
      params(['operator.md'])
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8'
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="operator.md"'
    );
  });

  it.each(['admin-home.png', 'warehouse-login.png'])(
    'serves the actual screenshot %s as a private PNG',
    async (name) => {
      jest
        .mocked(readFile)
        .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const response = await GET(
        request(`/demo/guide/assets/screens/${name}`),
        params(['assets', 'screens', name])
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(readFile).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`demo-guides/assets/screens/${name.replace('.', '\\.')}$`)
        )
      );
    }
  );

  it.each([
    ['index.html', '/demo/manual/README'],
    ['retail.html', '/demo/manual/retail'],
    ['warehouse.html', '/demo/manual/warehouse'],
  ])('redirects the former %s URL to %s', async (name, destination) => {
    const response = await GET(request(`/demo/guide/${name}`), params([name]));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `https://admin.almondyoung-next.com${destination}`
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([['output', 'pdf', 'retail.pdf'], ['retail.pdf']])(
    'returns 404 for former PDF path %j',
    async (...path) => {
      expect((await GET(request(), params(path))).status).toBe(404);
      expect(readFile).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['..', 'README.md'],
    ['assets', '..', 'README.md'],
    ['a/b.md'],
    ['.env'],
    ['scripts', 'render-guides.mjs'],
    ['unknown.md'],
  ])(
    'rejects traversal or files outside the reviewed scope %j',
    async (...path) => {
      expect((await GET(request(), params(path))).status).toBe(404);
      expect(readFile).not.toHaveBeenCalled();
    }
  );
});
