import { ConfigService } from '@nestjs/config';
import { HttpRolePermissionSource } from './http-role-permission.source';
import { parseSnapshot } from './role-permission-source';

const config = (values: Record<string, string>) => new ConfigService(values);

describe('HttpRolePermissionSource', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is not configured without a url and a key', () => {
    expect(new HttpRolePermissionSource(config({ USER_SERVICE_URL: 'http://u' })).isConfigured()).toBe(false);
    expect(
      new HttpRolePermissionSource(
        config({ USER_SERVICE_URL: 'http://u', USER_SERVICE_INTERNAL_KEY: 'k' }),
      ).isConfigured(),
    ).toBe(true);
  });

  it('sends the key and the known version, and maps 304', async () => {
    const seen: { url: string; headers: HeadersInit | undefined }[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: init?.headers });
      return new Response(null, { status: 304 });
    });
    const source = new HttpRolePermissionSource(
      config({ USER_SERVICE_URL: 'http://u/', USER_SERVICE_INTERNAL_KEY: 'k' }),
    );
    await expect(source.fetch('v1')).resolves.toEqual({ status: 'not_modified' });
    expect(seen).toEqual([
      {
        url: 'http://u/internal/iam/role-permissions',
        headers: { authorization: 'Bearer k', 'if-none-match': '"v1"' },
      },
    ]);
  });

  it('parses a 200 body into a map', async () => {
    global.fetch = jest.fn(async () =>
      Response.json({ version: 'v2', roles: { admin: ['a.b.read'], constructor: [] } }),
    );
    const source = new HttpRolePermissionSource(
      config({ USER_SERVICE_URL: 'http://u', USER_SERVICE_INTERNAL_KEY: 'k' }),
    );
    const result = await source.fetch(null);
    expect(result.status === 'loaded' && [...result.snapshot.roles]).toEqual([
      ['admin', ['a.b.read']],
      ['constructor', []],
    ]);
  });

  it('throws on an error status', async () => {
    global.fetch = jest.fn(async () => new Response('no', { status: 401 }));
    const source = new HttpRolePermissionSource(
      config({ USER_SERVICE_URL: 'http://u', USER_SERVICE_INTERNAL_KEY: 'k' }),
    );
    await expect(source.fetch(null)).rejects.toThrow('responded 401');
  });
});

describe('parseSnapshot', () => {
  it('rejects malformed bodies', () => {
    expect(() => parseSnapshot(null)).toThrow();
    expect(() => parseSnapshot({ version: '', roles: {} })).toThrow();
    expect(() => parseSnapshot({ version: 'v', roles: [] })).toThrow();
    expect(() => parseSnapshot({ version: 'v', roles: { admin: 'a.b.read' } })).toThrow();
    expect(() => parseSnapshot({ version: 'v', roles: { admin: [1] } })).toThrow();
  });

  it('keeps a __proto__ role from JSON as a plain entry', () => {
    const parsed = parseSnapshot(JSON.parse('{"version":"v","roles":{"__proto__":["a.b.read"]}}'));
    expect([...parsed.roles]).toEqual([['__proto__', ['a.b.read']]]);
  });
});
