import { outboundTenantForTesting } from '@app/tenancy';
import { ConfigService } from '@nestjs/config';
import { UgcAlmondDesignClient } from './ugc-almond-design.client';

const ID = '0190f1d2-0000-7000-8000-000000000001';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('UgcAlmondDesignClient', () => {
  const config = new ConfigService({ UGC_SERVICE_URL: 'http://ugc.local/', UGC_INTERNAL_KEY: 'k' });
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('reads design info with the internal key', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { id: ID, userId: 'u1', productId: 'p1', widthMm: 90, heightMm: 50, hasBack: true, extra: 1 }),
    );

    await expect(new UgcAlmondDesignClient(config, outboundTenantForTesting(undefined)).design(ID)).resolves.toEqual({
      userId: 'u1',
      productId: 'p1',
      widthMm: 90,
      heightMm: 50,
      hasBack: true,
    });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(`http://ugc.local/internal/almond-designs/${ID}`);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer k');
  });

  it('requests a print link with format and dpi', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { url: 'https://s3/x.jpg', expiresAt: '2026-10-14T00:05:00Z', fileName: 'x.jpg' }),
    );

    await expect(
      new UgcAlmondDesignClient(config, outboundTenantForTesting(undefined)).printLink(ID, 'jpg', 350),
    ).resolves.toEqual({
      url: 'https://s3/x.jpg',
      fileName: 'x.jpg',
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `http://ugc.local/internal/almond-designs/${ID}/print-link?format=jpg&dpi=350`,
    );
  });

  it('throws with the status on a non-2xx response', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(404, { message: 'not found' }));

    await expect(new UgcAlmondDesignClient(config, outboundTenantForTesting(undefined)).design(ID)).rejects.toThrow(
      '404',
    );
  });

  it('throws on a malformed body', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { productId: 'p1' }));

    await expect(new UgcAlmondDesignClient(config, outboundTenantForTesting(undefined)).design(ID)).rejects.toThrow();
  });

  it('refuses when UGC_SERVICE_URL or UGC_INTERNAL_KEY is missing', async () => {
    await expect(
      new UgcAlmondDesignClient(new ConfigService({}), outboundTenantForTesting(undefined)).design(ID),
    ).rejects.toThrow('UGC_SERVICE_URL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
