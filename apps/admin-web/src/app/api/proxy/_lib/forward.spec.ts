import type { NextRequest } from 'next/server';
import { forwardRequest } from './forward';

function fakeRequest(): NextRequest {
  return {
    method: 'GET',
    nextUrl: { search: '' },
    headers: new Headers(),
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
});
