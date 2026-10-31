import { ConfigService } from '@nestjs/config';
import { HttpTenantStatusSource } from './http-tenant-status.source';

const config = (values: Record<string, string>) => new ConfigService(values);
const configured = () =>
  new HttpTenantStatusSource(config({ USER_SERVICE_URL: 'http://u/', USER_SERVICE_INTERNAL_KEY: 'k' }));

describe('HttpTenantStatusSource', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is not configured without a url and a key', () => {
    expect(new HttpTenantStatusSource(config({ USER_SERVICE_URL: 'http://u' })).isConfigured()).toBe(false);
    expect(configured().isConfigured()).toBe(true);
  });

  it('asks the internal route with the key and maps the body', async () => {
    const seen: { url: string; headers: HeadersInit | undefined }[] = [];
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: url instanceof Request ? url.url : url.toString(), headers: init?.headers });
      return Promise.resolve(
        Response.json({
          tenants: [
            { id: '1', status: 'active' },
            { id: '2', status: 'suspended' },
          ],
        }),
      );
    });

    const statuses = await configured().fetch();
    expect([...statuses]).toEqual([
      ['1', 'active'],
      ['2', 'suspended'],
    ]);
    expect(seen).toEqual([{ url: 'http://u/internal/iam/tenant-statuses', headers: { authorization: 'Bearer k' } }]);
  });

  it('throws on a non-2xx answer', async () => {
    global.fetch = jest.fn(() => Promise.resolve(new Response('nope', { status: 503 })));
    await expect(configured().fetch()).rejects.toThrow('503');
  });

  it('throws on a malformed body instead of installing a partial copy', async () => {
    global.fetch = jest.fn(() => Promise.resolve(Response.json({ tenants: [{ id: '1', status: 'paused' }] })));
    await expect(configured().fetch()).rejects.toThrow('malformed');
    global.fetch = jest.fn(() => Promise.resolve(Response.json({ tenants: 'all' })));
    await expect(configured().fetch()).rejects.toThrow('malformed');
  });
});
