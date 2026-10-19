import { AdminApi, ApiError } from './api';
import fastify from 'fastify';

function response(status: number, data?: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(data ?? {}), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeApi(fetcher: typeof fetch, extra: Record<string, unknown> = {}) {
  return new AdminApi({
    loginUrl: 'https://user.almondyoung.com/auth/signin',
    loginId: 'test-admin',
    password: 'test-only',
    fetcher,
    allowedOrigins: ['https://ugc.almondyoung.com', 'https://core.almondyoung.com'],
    checkWrite: () => {},
    ...extra,
  });
}

describe('administrator API authentication and write boundary', () => {
  it('sends bodyless DELETE requests that Fastify accepts before invoking the handler', async () => {
    const server = fastify();
    let deleted = false;

    server.post('/auth/signin', async () => ({ accessToken: 'test-token' }));
    server.delete('/reviews/admin/reviews/test-review', async (_, reply) => {
      deleted = true;

      return reply.code(204).send();
    });

    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const fetcher: typeof fetch = async (url, options) => {
      return fetch(new URL(new URL(String(url)).pathname, address), options);
    };

    try {
      const result = await makeApi(fetcher).request(
        'https://ugc.almondyoung.com/reviews/admin/reviews/test-review',
        'DELETE',
      );

      expect(result.status).toBe(204);
      expect(deleted).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('logs in with memory credentials and reauthenticates exactly once after 401', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    let loginCount = 0;
    let deletes = 0;
    const fetcher = jest.fn(async (url, options) => {
      requests.push({ url: String(url), authorization: (options?.headers as Record<string, string>)?.authorization });
      if (String(url).includes('/auth/signin')) return response(200, { accessToken: `token-${++loginCount}` });
      return response(++deletes === 1 ? 401 : 204);
    }) as typeof fetch;
    const api = makeApi(fetcher);

    expect((await api.request('https://ugc.almondyoung.com/reviews/admin/reviews/a', 'DELETE')).status).toBe(204);
    expect(loginCount).toBe(2);
    expect(deletes).toBe(2);
    expect(requests[3].authorization).toBe('Bearer token-2');
  });

  it('stops after a new token is rejected, rather than looping login attempts', async () => {
    let logins = 0;
    const fetcher = jest.fn(async (url) =>
      String(url).includes('/auth/signin') ? response(200, { accessToken: `token-${++logins}` }) : response(401),
    ) as typeof fetch;

    await expect(
      makeApi(fetcher).request('https://ugc.almondyoung.com/reviews/admin/reviews/a', 'DELETE'),
    ).rejects.toMatchObject({ status: 401 });
    expect(logins).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not retry ambiguous writes, 5xx, or rate limits', async () => {
    for (const status of [429, 503]) {
      const fetcher = jest.fn(async (url) =>
        String(url).includes('/auth/signin') ? response(200, { accessToken: 'token' }) : response(status),
      ) as typeof fetch;
      await expect(
        makeApi(fetcher).request('https://ugc.almondyoung.com/reviews/admin/reviews/a', 'DELETE'),
      ).rejects.toBeInstanceOf(ApiError);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it('blocks dry-run mutations and foreign origins before authenticating', async () => {
    const fetcher = jest.fn() as typeof fetch;
    await expect(
      makeApi(fetcher, { dryRun: true }).request('https://ugc.almondyoung.com/reviews/admin/reviews/a', 'DELETE'),
    ).rejects.toThrow('dry run');
    await expect(makeApi(fetcher).request('https://example.com/reviews', 'GET')).rejects.toThrow('origin');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rechecks the dated write boundary after reauthentication', async () => {
    let checks = 0;
    const fetcher = jest.fn(async (url) =>
      String(url).includes('/auth/signin') ? response(200, { accessToken: 'token' }) : response(401),
    ) as typeof fetch;
    const api = makeApi(fetcher, {
      checkWrite: () => {
        if (++checks > 1) throw new Error('closed write window');
      },
    });

    await expect(api.request('https://ugc.almondyoung.com/reviews/admin/reviews/a', 'DELETE')).rejects.toThrow(
      'closed write window',
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
