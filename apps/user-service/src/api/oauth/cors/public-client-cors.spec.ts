import fastifyCors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { parse as parseQuery } from 'querystring';
import {
  collectPublicClientOrigins,
  createCorsDelegator,
  isPublicClientOriginAllowed,
  type PublicClientOriginSource,
} from './public-client-cors';

const STATIC_ORIGIN = 'https://auth.almondyoung.com';

const CLIENTS: PublicClientOriginSource[] = [
  {
    clientType: 'public',
    isActive: true,
    redirectUris: ['http://localhost:5173/callback', 'https://argus.pages.dev/callback'],
  },
  { clientType: 'confidential', isActive: true, redirectUris: ['https://daview.com/auth/callback'] },
  { clientType: 'public', isActive: false, redirectUris: ['https://retired-spa.example.com/callback'] },
  { clientType: 'public', isActive: true, redirectUris: ['almondyoung://oauth/callback'] },
];

// main.ts 와 같은 모양의 앱. CORS 훅은 라우팅 전에 돌기 때문에 핸들러는 껍데기면 된다.
async function buildApp(isPublicClientOrigin: (origin: string) => Promise<boolean>): Promise<FastifyInstance> {
  const app = Fastify();
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, parseQuery(body as string)),
  );
  await app.register(fastifyCors, {
    delegator: createCorsDelegator({
      staticOptions: {
        origin: [STATIC_ORIGIN],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'Set-Cookie'],
        exposedHeaders: ['Set-Cookie'],
      },
      isPublicClientOrigin,
      onLookupError: () => undefined,
    }),
  });
  app.post('/oauth/token', async (req) => ({ grantType: (req.body as Record<string, string>).grant_type }));
  app.get('/oauth/userinfo', async () => ({ sub: 'u1' }));
  app.post('/oauth/end_session', async () => ({ redirectUrl: null }));
  app.get('/users/me', async () => ({ id: 'u1' }));
  await app.ready();
  return app;
}

function preflight(app: FastifyInstance, url: string, origin: string, method = 'POST') {
  return app.inject({
    method: 'OPTIONS',
    url,
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type',
    },
  });
}

describe('공개 OAuth 클라이언트 CORS', () => {
  let app: FastifyInstance;
  let lookups: number;

  beforeAll(async () => {
    const origins = collectPublicClientOrigins(CLIENTS);
    lookups = 0;
    app = await buildApp(async (origin) => {
      lookups += 1;
      return isPublicClientOriginAllowed(origin, origins);
    });
  });

  afterAll(() => app.close());

  it('preflight /oauth/token: 등록된 loopback origin 을 credentials 없이 허용한다', async () => {
    const res = await preflight(app, '/oauth/token', 'http://localhost:5173');
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBe('POST, GET, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
    expect(res.headers['vary']).toMatch(/Origin/);
  });

  it('loopback 은 포트를 따지지 않는다 (redirect_uri 검증과 같게)', async () => {
    const res = await preflight(app, '/oauth/token', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('loopback 이라도 등록된 hostname 만 — localhost 등록이 127.0.0.1 을 열지 않는다', async () => {
    const res = await preflight(app, '/oauth/token', 'http://127.0.0.1:5173');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('https 등록 origin 을 허용한다', async () => {
    const res = await preflight(app, '/oauth/token', 'https://argus.pages.dev');
    expect(res.headers['access-control-allow-origin']).toBe('https://argus.pages.dev');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('https origin 은 포트가 다르면 허용하지 않는다', async () => {
    const res = await preflight(app, '/oauth/token', 'https://argus.pages.dev:8443');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    ['미등록 origin', 'https://evil.example.com'],
    ['confidential 클라이언트의 redirect origin', 'https://daview.com'],
    ['비활성 공개 클라이언트의 origin', 'https://retired-spa.example.com'],
  ])('%s 은 ACAO 가 없다', async (_label, origin) => {
    const res = await preflight(app, '/oauth/token', origin);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('대상이 아닌 경로(쿠키 인증 API)에서는 공개 클라이언트 origin 도 ACAO 가 없다', async () => {
    const pre = await preflight(app, '/users/me', 'http://localhost:5173', 'GET');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    const res = await app.inject({ method: 'GET', url: '/users/me', headers: { origin: 'http://localhost:5173' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('end_session 은 POST 만 연다', async () => {
    const post = await preflight(app, '/oauth/end_session', 'http://localhost:5173', 'POST');
    expect(post.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const get = await app.inject({
      method: 'GET',
      url: '/oauth/end_session',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Bearer userinfo GET 에 ACAO 가 붙는다', async () => {
    const pre = await app.inject({
      method: 'OPTIONS',
      url: '/oauth/userinfo',
      headers: {
        origin: 'https://argus.pages.dev',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(pre.headers['access-control-allow-origin']).toBe('https://argus.pages.dev');
    const res = await app.inject({
      method: 'GET',
      url: '/oauth/userinfo',
      headers: { origin: 'https://argus.pages.dev', authorization: 'Bearer t' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://argus.pages.dev');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('CORS_ORIGIN_DOMAINS 의 origin 은 OAuth 경로에서도 기존처럼 credentials: true 이고 DB 를 보지 않는다', async () => {
    const before = lookups;
    const res = await preflight(app, '/oauth/token', STATIC_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(STATIC_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    const other = await app.inject({ method: 'GET', url: '/users/me', headers: { origin: STATIC_ORIGIN } });
    expect(other.headers['access-control-allow-origin']).toBe(STATIC_ORIGIN);
    expect(other.headers['access-control-allow-credentials']).toBe('true');
    expect(lookups).toBe(before);
  });

  it('실제 POST /oauth/token (form-urlencoded, refresh_token) 응답에도 ACAO 가 붙는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=refresh_token&refresh_token=r&client_id=argus',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ grantType: 'refresh_token' });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['vary']).toMatch(/Origin/);
  });

  it('origin 조회가 실패해도 요청은 죽지 않고 기존 규칙만 적용된다', async () => {
    const failing = await buildApp(async () => {
      throw new Error('db down');
    });
    const res = await failing.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=refresh_token',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await failing.close();
  });
});

describe('isPublicClientOriginAllowed', () => {
  const origins = collectPublicClientOrigins([
    { clientType: 'public', isActive: true, redirectUris: ['http://[::1]:8080/cb', 'https://spa.example.com/cb'] },
  ]);

  it('IPv6 loopback 도 포트 무관', () => {
    expect(isPublicClientOriginAllowed('http://[::1]:3000', origins)).toBe(true);
  });

  it.each(['https://spa.example.com/', 'HTTPS://spa.example.com', 'null', '*', 'https://spa.example.com.evil.com'])(
    '정규형 origin 이 아니거나 다른 host 면 거부: %s',
    (origin) => {
      expect(isPublicClientOriginAllowed(origin, origins)).toBe(false);
    },
  );

  it('loopback 이라도 https 는 정확 일치로 다룬다', () => {
    const httpsLoopback = collectPublicClientOrigins([
      { clientType: 'public', isActive: true, redirectUris: ['https://localhost:5173/cb'] },
    ]);
    expect(isPublicClientOriginAllowed('https://localhost:5173', httpsLoopback)).toBe(true);
    expect(isPublicClientOriginAllowed('https://localhost:3000', httpsLoopback)).toBe(false);
    expect(isPublicClientOriginAllowed('http://localhost:5173', httpsLoopback)).toBe(false);
  });
});
