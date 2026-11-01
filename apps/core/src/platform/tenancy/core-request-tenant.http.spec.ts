import { CanActivate, Controller, ExecutionContext, Get, Injectable, Query, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { register } from 'prom-client';
import { IS_PUBLIC_KEY, IS_SERVICE_KEY_ROUTE_KEY } from '@app/authorization';
import { mountEventChainContext } from '@app/events';
import { GlobalExceptionFilter } from '@app/shared';
import { parseTenantList, TENANT_CONTEXT_KEY, TenancyConfig, type TenantGateMode } from '@app/tenancy';
import { coreRequestTenantProviders, PUBLIC_ROUTE_TOKEN } from './core-request-tenant.interceptor';
import { TenantFree } from './tenant-free.decorator';
import { TenantStatusCache, TenantStatusSource, type TenantStatus } from './tenant-status-cache';

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'b-two-pub', privateBucket: 'b-two-priv' },
  ]),
);

/** user-service 테넌트 상태 자리. 스펙이 값을 바꾸고 `TenantStatusCache.refresh()` 로 들인다. */
const statuses = new Map<string, TenantStatus>();
class FakeTenantStatusSource extends TenantStatusSource {
  isConfigured(): boolean {
    return true;
  }
  fetch(): Promise<ReadonlyMap<string, TenantStatus>> {
    return Promise.resolve(new Map(statuses));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 핸들러가 끝난 뒤(응답 뒤) 돈 비동기 콜백이 본 테넌트. */
const background: Array<{ id: string; tenant: string | undefined }> = [];

/** 테스트용 «토큰»: `x-test-user` 헤더의 JSON 이 검증된 사용자다. */
function userFrom(request: { headers: Record<string, string | undefined> }): object | undefined {
  const raw = request.headers['x-test-user'];
  if (!raw) return undefined;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
}

/** 전역 JwtAuthGuard 자리 — @Public 이 아닌 라우트에서만 사용자를 채운다. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) === true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: object }>();
    if (!isPublic) request.user = userFrom(request);
    return true;
  }
}

@Controller()
class ProbeController {
  constructor(private readonly cls: ClsService) {}

  private async observe(id: string, delay: string | undefined) {
    await sleep(Number(delay ?? 0));
    const tenant = this.cls.get<string | undefined>(TENANT_CONTEXT_KEY);
    setTimeout(() => background.push({ id, tenant: this.cls.get<string | undefined>(TENANT_CONTEXT_KEY) }), 20);
    return { tenant: tenant ?? null };
  }

  @Get('token')
  token(@Query('id') id: string, @Query('delay') delay?: string) {
    return this.observe(id, delay);
  }

  @SetMetadata(IS_PUBLIC_KEY, true)
  @Get('public')
  public(@Query('id') id: string) {
    return this.observe(id, undefined);
  }

  @SetMetadata(IS_PUBLIC_KEY, true)
  @SetMetadata(IS_SERVICE_KEY_ROUTE_KEY, true)
  @Get('internal')
  internal(@Query('id') id: string) {
    return this.observe(id, undefined);
  }

  @SetMetadata(IS_PUBLIC_KEY, true)
  @TenantFree()
  @Get('health')
  health() {
    return { tenant: this.cls.get<string | undefined>(TENANT_CONTEXT_KEY) ?? null };
  }
}

async function boot(mode: TenantGateMode): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, middleware: { mount: false } })],
    controllers: [ProbeController],
    providers: [
      { provide: TenancyConfig, useValue: new TenancyConfig(tenants, mode) },
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      ...coreRequestTenantProviders(),
    ],
  })
    // @Public 라우트의 토큰 읽기(실제는 passport) 자리.
    .overrideProvider(PUBLIC_ROUTE_TOKEN)
    .useValue({
      read: (context: ExecutionContext) => {
        const request = context
          .switchToHttp()
          .getRequest<{ headers: Record<string, string | undefined>; user?: object | null }>();
        request.user = userFrom(request) ?? null;
        return Promise.resolve();
      },
    })
    .overrideProvider(TenantStatusSource)
    .useValue(new FakeTenantStatusSource())
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  mountEventChainContext(app);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await app.get(TenantStatusCache).refresh();
  return app;
}

const user = (tenant?: string) => JSON.stringify(tenant ? { sub: 'u', tenant } : { sub: 'u' });

async function untenantedCount(entry: string): Promise<number> {
  const metric = await register.getSingleMetric('core_untenanted_requests_total')?.get();
  return metric?.values.find((v) => v.labels.entry === entry)?.value ?? 0;
}

describe('core 요청 테넌트 맥락 (HTTP)', () => {
  beforeEach(() => {
    statuses.clear();
    statuses.set('1', 'active');
    statuses.set('2', 'active');
  });

  describe.each(['reject', 'warn'] as const)('정지 스위치 (%s)', (mode) => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await boot(mode);
    });
    afterAll(async () => {
      await app.close();
    });
    const switchTo = async (status: TenantStatus) => {
      statuses.set('2', status);
      await app.get(TenantStatusCache).refresh();
    };

    it('정지된 테넌트의 사람 토큰은 갱신 뒤 바로 403 이고, 다른 테넌트는 그대로다', async () => {
      await switchTo('suspended');
      expect((await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user('2') } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/public?id=x', headers: { 'x-test-user': user('2') } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user('1') } })).json()).toEqual({
        tenant: '1',
      });
    });

    it('서비스 신원(내부 키+헤더) 호출은 막지 않는다 — 정지는 사람 토큰을 멈추는 스위치다', async () => {
      await switchTo('suspended');
      expect((await app.inject({ url: '/internal?id=x', headers: { 'x-tenant-id': '2' } })).json()).toEqual({
        tenant: '2',
      });
    });

    it('활성으로 되돌리면 다음 갱신부터 다시 통과한다', async () => {
      await switchTo('suspended');
      expect((await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user('2') } })).statusCode).toBe(403);
      await switchTo('active');
      expect((await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user('2') } })).json()).toEqual({
        tenant: '2',
      });
    });
  });

  describe('② reject', () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await boot('reject');
    });
    afterAll(async () => {
      await app.close();
    });

    it('동시 요청 두 개가 서로 다른 테넌트여도 맥락이 섞이지 않는다 — 응답 뒤 비동기 콜백도 제 요청의 테넌트만 본다', async () => {
      background.length = 0;
      const [slow, fast] = await Promise.all([
        app.inject({ url: '/token?id=slow&delay=60', headers: { 'x-test-user': user('1') } }),
        app.inject({ url: '/token?id=fast&delay=5', headers: { 'x-test-user': user('2') } }),
      ]);
      expect([slow.json(), fast.json()]).toEqual([{ tenant: '1' }, { tenant: '2' }]);

      // 앞 요청들의 맥락이 다음 요청으로 새지 않는다.
      const after = await app.inject({ url: '/health' });
      expect(after.json()).toEqual({ tenant: null });

      await sleep(60);
      expect(background).toEqual(
        expect.arrayContaining([
          { id: 'slow', tenant: '1' },
          { id: 'fast', tenant: '2' },
        ]),
      );
    });

    it('맥락을 정할 수 없는 요청은 403 이다(토큰 없음·클레임 없는 토큰·헤더 없는 내부 키)', async () => {
      expect((await app.inject({ url: '/token?id=x' })).statusCode).toBe(403);
      expect((await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user() } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/internal?id=x' })).statusCode).toBe(403);
      expect((await app.inject({ url: '/public?id=x' })).statusCode).toBe(403);
    });

    // 토큰≠헤더 거절은 resolveRequestTenant 스펙이 본다 — 내부 키 라우트는 Authorization 에 키가 실려 사람 토큰이 오지 않는다.
    it('내부 키 입구: 헤더가 맥락이고, 목록에 없으면 거절한다', async () => {
      expect((await app.inject({ url: '/internal?id=x', headers: { 'x-tenant-id': '2' } })).json()).toEqual({
        tenant: '2',
      });
      expect((await app.inject({ url: '/internal?id=x', headers: { 'x-tenant-id': '9' } })).statusCode).toBe(403);
    });

    it('@Public: 헤더 또는 사람 토큰이 맥락이고, 둘이 다르면 거절한다', async () => {
      expect((await app.inject({ url: '/public?id=x', headers: { 'x-tenant-id': '1' } })).json()).toEqual({
        tenant: '1',
      });
      expect((await app.inject({ url: '/public?id=x', headers: { 'x-test-user': user('2') } })).json()).toEqual({
        tenant: '2',
      });
      const mismatch = await app.inject({
        url: '/public?id=x',
        headers: { 'x-test-user': user('2'), 'x-tenant-id': '1' },
      });
      expect(mismatch.statusCode).toBe(403);
    });

    it('테넌트를 정하지 않는 라우트(ALB 헬스체크)는 토큰·헤더 없이 통과한다', async () => {
      expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    });
  });

  describe('① warn', () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await boot('warn');
    });
    afterAll(async () => {
      await app.close();
    });

    it('클레임 없는 요청을 거절하지 않고 입구별로 센다', async () => {
      const before = { token: await untenantedCount('token'), service: await untenantedCount('service') };

      expect((await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user() } })).json()).toEqual({
        tenant: null,
      });
      expect((await app.inject({ url: '/internal?id=x' })).statusCode).toBe(200);

      expect(await untenantedCount('token')).toBe(before.token + 1);
      expect(await untenantedCount('service')).toBe(before.service + 1);
    });

    it('@Public 의 클레임 없는 토큰은 헤더로 통과하되 token 셈에 잡힌다(쇼핑몰 공개 조회를 찾는 셈)', async () => {
      const before = await untenantedCount('token');
      const res = await app.inject({ url: '/public?id=x', headers: { 'x-test-user': user(), 'x-tenant-id': '1' } });
      expect(res.json()).toEqual({ tenant: '1' });
      expect(await untenantedCount('token')).toBe(before + 1);
    });

    it('정해진 테넌트는 ① 에서도 맥락에 싣는다(서비스 간 헤더가 그 값을 쓴다)', async () => {
      expect((await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user('1') } })).json()).toEqual({
        tenant: '1',
      });
    });

    it('토큰과 헤더가 다르면 ① 에서도 거절한다 — 모르는 게 아니라 틀린 값이다', async () => {
      const res = await app.inject({ url: '/token?id=x', headers: { 'x-test-user': user('1'), 'x-tenant-id': '2' } });
      expect(res.statusCode).toBe(403);
    });
  });
});
