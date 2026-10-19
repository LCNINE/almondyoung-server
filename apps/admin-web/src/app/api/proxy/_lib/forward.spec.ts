import type { NextRequest } from 'next/server';
import { forwardRequest } from './forward';

function fakeRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    method: 'GET',
    nextUrl: { search: '' },
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as NextRequest;
}

describe('forwardRequest', () => {
  let mockedFetch: jest.Mock;

  beforeEach(() => {
    mockedFetch = jest.fn();
    (globalThis as { fetch: unknown }).fetch = mockedFetch;
  });

  it('기본값은 리다이렉트를 따라가고 본문을 그대로 나른다', async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await forwardRequest(fakeRequest(), 'http://upstream', [
      'files',
      'x',
      'metadata',
    ]);

    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ redirect: 'follow' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('passThroughRedirects 면 302 와 Location 을 브라우저에 그대로 넘긴다', async () => {
    // 큰 이미지의 S3 302 를 따라가 본문을 나르면 Lambda 응답 상한에 걸려 502 가 난다
    mockedFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://bucket.example/key.webp' },
      })
    );

    const res = await forwardRequest(
      fakeRequest(),
      'http://upstream',
      ['files', 'public', 'x'],
      { passThroughRedirects: true }
    );

    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://bucket.example/key.webp');
  });

  it('passThroughRedirects 라도 2xx 응답은 종전대로 본문을 나른다', async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ signedUrl: 'https://x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await forwardRequest(
      fakeRequest(),
      'http://upstream',
      ['files', 'x', 'download'],
      { passThroughRedirects: true }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedUrl: 'https://x' });
  });

  describe('직원 단말 주소와 개인정보 표시 헤더', () => {
    const okUpstream = (headers: Record<string, string> = {}) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
    const sentHeaders = (): Headers => mockedFetch.mock.calls[0][1].headers;

    afterEach(() => {
      delete process.env.ADMIN_WEB_TRUSTED_PROXY_HOPS;
    });

    it('adds the staff client ip from the rightmost forwarded address', async () => {
      mockedFetch.mockResolvedValue(okUpstream());
      await forwardRequest(fakeRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7' }), 'http://upstream', ['x']);
      expect(sentHeaders().get('x-staff-client-ip')).toBe('203.0.113.7');
      expect(sentHeaders().get('x-staff-forwarded-for')).toBe('198.51.100.1, 203.0.113.7');
    });

    it('picks the address the single trusted proxy appended, not one the browser wrote', async () => {
      process.env.ADMIN_WEB_TRUSTED_PROXY_HOPS = '1';
      mockedFetch.mockResolvedValue(okUpstream());
      await forwardRequest(fakeRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7' }), 'http://upstream', ['x']);
      expect(sentHeaders().get('x-staff-client-ip')).toBe('203.0.113.7');
    });

    it('honors the trusted proxy hop count', async () => {
      process.env.ADMIN_WEB_TRUSTED_PROXY_HOPS = '2';
      mockedFetch.mockResolvedValue(okUpstream());
      await forwardRequest(fakeRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7' }), 'http://upstream', ['x']);
      expect(sentHeaders().get('x-staff-client-ip')).toBe('198.51.100.1');
    });

    it('drops a client ip header sent by the browser', async () => {
      mockedFetch.mockResolvedValue(okUpstream());
      await forwardRequest(fakeRequest({ 'x-staff-client-ip': '10.9.9.9' }), 'http://upstream', ['x']);
      expect(sentHeaders().get('x-staff-client-ip')).toBeNull();
    });

    it('ignores a forwarded address that is not an ip', async () => {
      mockedFetch.mockResolvedValue(okUpstream());
      await forwardRequest(fakeRequest({ 'x-forwarded-for': 'evil<script>' }), 'http://upstream', ['x']);
      expect(sentHeaders().get('x-staff-client-ip')).toBeNull();
    });

    it('forwards the reveal and export reason request headers to the backend', async () => {
      mockedFetch.mockResolvedValue(okUpstream());
      await forwardRequest(fakeRequest({ 'x-pii-reveal': '1', 'x-pii-export-reason': '%EC%A0%95%EC%82%B0' }), 'http://upstream', ['x']);
      expect(sentHeaders().get('x-pii-reveal')).toBe('1');
      expect(sentHeaders().get('x-pii-export-reason')).toBe('%EC%A0%95%EC%82%B0');
    });

    it('passes pii response headers through', async () => {
      mockedFetch.mockResolvedValue(
        okUpstream({ 'x-pii-masked': 'name,phone', 'x-pii-mask-reason': 'no-permission', 'x-pii-redacted': 'deltas' }),
      );
      const res = await forwardRequest(fakeRequest(), 'http://upstream', ['x']);
      expect(res.headers.get('x-pii-masked')).toBe('name,phone');
      expect(res.headers.get('x-pii-mask-reason')).toBe('no-permission');
      expect(res.headers.get('x-pii-redacted')).toBe('deltas');
    });
  });
});
