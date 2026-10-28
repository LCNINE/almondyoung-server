import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Req,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { register } from 'prom-client';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { AuthzObserverGuard } from '../guards/authz-observer.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { AuthzShadowInterceptor } from '../interceptors/authz-shadow.interceptor';
import { AuthzShadowRecorder } from './authz-shadow.recorder';
import { PermissionCache } from './permission-cache';
import { getPermissionDecision } from './permission-decision';
import { PermissionDecider } from './permission-decider';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './permission-runtime.options';
import { RouteRequirement, RouteRequirementResolver } from './route-requirement.resolver';

const options: PermissionRuntimeOptions = {
  service: 'core',
  refreshIntervalMs: 30_000,
  retryBaseMs: 1_000,
  summaryIntervalMs: 300_000,
};
const order: RouteRequirement = { kind: 'permission', anyOf: ['order.order.read'] };

const cache = (byRole: Record<string, string[]> | null): Pick<PermissionCache, 'permissionsFor' | 'status'> => ({
  permissionsFor: (roles) => (byRole === null ? null : new Set(roles.flatMap((role) => byRole[role] ?? []))),
  status: () => ({
    state: byRole ? 'ready' : 'cold',
    version: byRole ? 'v1' : null,
    ageMs: byRole ? 1_000 : null,
    consecutiveFailures: 0,
  }),
});

const outcomeCount = async (outcome: string) => {
  const metric = await register.getSingleMetric('authz_shadow_evaluations_total')?.get();
  return metric?.values.find((v) => v.labels.service === 'core' && v.labels.outcome === outcome)?.value ?? 0;
};

function exchange(user?: { roles: string[] }) {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  const request = user ? { user } : {};
  const finish = (status: number) => {
    response.statusCode = status;
    response.emit('finish');
  };
  return { request, response, finish };
}

describe('AuthzShadowRecorder', () => {
  let recorder: AuthzShadowRecorder;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  const build = (byRole: Record<string, string[]> | null) => {
    const c = cache(byRole);
    recorder = new AuthzShadowRecorder(new PermissionDecider(c), c, options);
  };

  beforeEach(() => {
    register.resetMetrics();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    recorder.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('counts a match when both allow', async () => {
    build({ admin: ['order.order.read'] });
    const { request, response, finish } = exchange({ roles: ['admin'] });
    recorder.observe(request, response, 'GET /orders', order);
    recorder.markPassed(request);
    finish(200);
    expect(await outcomeCount('match')).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('flags a request the permission decision would deny', async () => {
    build({ intern: [] });
    const { request, response, finish } = exchange({ roles: ['intern'] });
    recorder.observe(request, response, 'GET /orders', order);
    recorder.markPassed(request);
    finish(200);
    expect(await outcomeCount('would_deny')).toBe(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({
      event: 'authz_shadow_mismatch',
      service: 'core',
      mode: 'enforce',
      route: 'GET /orders',
      roles: ['intern'],
      legacy: 'allow',
      next: 'deny',
      reason: 'missing_permission',
      required: ['order.order.read'],
    });
  });

  it('records a legacy denial that happened in a later guard', async () => {
    build({ logistics_worker: ['order.order.read'] });
    const { request, response, finish } = exchange({ roles: ['logistics_worker'] });
    recorder.observe(request, response, 'GET /orders', order);
    finish(403);
    expect(await outcomeCount('would_allow')).toBe(1);
  });

  it('matches when an unauthenticated request is rejected by authentication', async () => {
    build({ admin: ['order.order.read'] });
    const { request, response, finish } = exchange();
    recorder.observe(request, response, 'GET /orders', order);
    finish(401);
    expect(await outcomeCount('match')).toBe(1);
  });

  it('skips responses that say nothing about authorization', async () => {
    build({ admin: ['order.order.read'] });
    const { request, response, finish } = exchange({ roles: ['admin'] });
    recorder.observe(request, response, 'GET /orders', order);
    finish(429);
    expect(await outcomeCount('match')).toBe(0);
    expect(await outcomeCount('would_allow')).toBe(0);
  });

  it('ignores a request that never finishes', async () => {
    build({ admin: ['order.order.read'] });
    const { request, response } = exchange({ roles: ['admin'] });
    recorder.observe(request, response, 'GET /orders', order);
    recorder.markPassed(request);
    response.emit('close');
    for (const outcome of ['match', 'would_deny', 'would_allow', 'unavailable']) {
      expect(await outcomeCount(outcome)).toBe(0);
    }
  });

  it('counts unavailable separately from mismatches', async () => {
    build(null);
    const { request, response, finish } = exchange({ roles: ['admin'] });
    recorder.observe(request, response, 'GET /orders', order);
    recorder.markPassed(request);
    finish(200);
    expect(await outcomeCount('unavailable')).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs the same mismatch once per window and sums it in the summary', () => {
    build({ intern: [] });
    for (let i = 0; i < 3; i += 1) {
      const { request, response, finish } = exchange({ roles: ['intern'] });
      recorder.observe(request, response, 'GET /orders', order);
      recorder.markPassed(request);
      finish(200);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    recorder.flush();
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
      event: 'authz_shadow_summary',
      service: 'core',
      evaluated: 3,
      match: 0,
      wouldDeny: 3,
      wouldAllow: 0,
      unavailable: 0,
      snapshotVersion: 'v1',
      mismatches: [{ route: 'GET /orders', roles: ['intern'], outcome: 'would_deny', count: 3 }],
    });
  });

  it('observes a request only once', async () => {
    build({ admin: ['order.order.read'] });
    const { request, response, finish } = exchange({ roles: ['admin'] });
    recorder.observe(request, response, 'GET /orders', order);
    recorder.observe(request, response, 'GET /orders', order);
    recorder.markPassed(request);
    finish(200);
    expect(await outcomeCount('match')).toBe(1);
  });

  it('stays quiet in a window without traffic', () => {
    build({ admin: [] });
    recorder.flush();
    expect(log).not.toHaveBeenCalled();
  });

  it('labels logs with the mode', () => {
    const c = cache({ intern: [] });
    recorder = new AuthzShadowRecorder(new PermissionDecider(c), c, options);
    const { request, response, finish } = exchange({ roles: ['intern'] });
    recorder.observe(request, response, 'GET /orders', order);
    recorder.markPassed(request);
    finish(200);
    expect(JSON.parse(String(warn.mock.calls[0][0])).mode).toBe('enforce');
    recorder.flush();
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).mode).toBe('enforce');
  });
});

@Controller('orders')
class OrdersProbeController {
  @RequirePermission('order.order.read')
  @Get()
  list(@Req() request: object) {
    return { ok: true, stamped: getPermissionDecision(request, 'order.order.read') !== undefined };
  }
}

/** 인증 가드 대역: 요청 헤더의 역할을 사용자로 붙인다. */
@Injectable()
class HeaderUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; user?: { roles: string[] } }>();
    const roles = request.headers['x-roles'];
    if (roles !== undefined) request.user = { roles: roles.split(',').filter(Boolean) };
    return true;
  }
}

/** 기존 인가 가드 대역: x-deny 헤더가 있으면 403. */
@Injectable()
class LegacyDenyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>().headers['x-deny']) {
      throw new ForbiddenException();
    }
    return true;
  }
}

describe('AuthzObserverGuard in a running app', () => {
  let app: NestFastifyApplication;
  let recorder: AuthzShadowRecorder;

  beforeAll(async () => {
    const c = cache({ logistics_worker: ['order.order.read'], intern: [] });
    recorder = new AuthzShadowRecorder(new PermissionDecider(c), c, options);
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersProbeController],
      providers: [
        RouteRequirementResolver,
        { provide: AuthzShadowRecorder, useValue: recorder },
        { provide: APP_GUARD, useClass: AuthzObserverGuard },
        { provide: APP_GUARD, useClass: HeaderUserGuard },
        { provide: APP_GUARD, useClass: LegacyDenyGuard },
        { provide: PermissionDecider, useValue: new PermissionDecider(c) },
        { provide: PERMISSION_RUNTIME_OPTIONS, useValue: options },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_INTERCEPTOR, useClass: AuthzShadowInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => register.resetMetrics());
  afterEach(() => jest.restoreAllMocks());

  it('sees a denial from a guard registered after it', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/orders',
      headers: { 'x-roles': 'logistics_worker', 'x-deny': '1' },
    });
    expect(res.statusCode).toBe(403);
    expect(await outcomeCount('would_allow')).toBe(1);
  });

  it('agrees with the permission guard that refuses a caller without the permission', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const res = await app.inject({ method: 'GET', url: '/orders', headers: { 'x-roles': 'intern' } });
    expect(res.statusCode).toBe(403);
    expect(await outcomeCount('match')).toBe(1);
    expect(await outcomeCount('would_deny')).toBe(0);
  });

  it('stamps the route decision before the handler runs', async () => {
    const granted = await app.inject({ method: 'GET', url: '/orders', headers: { 'x-roles': 'logistics_worker' } });
    expect(granted.json()).toEqual({ ok: true, stamped: true });
    const notGranted = await app.inject({ method: 'GET', url: '/orders', headers: { 'x-roles': 'intern' } });
    expect(notGranted.statusCode).toBe(403);
  });

  it('labels the route by its pattern, not its url', async () => {
    recorder.flush();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await app.inject({
      method: 'GET',
      url: '/orders?secret=1',
      headers: { 'x-roles': 'logistics_worker', 'x-deny': '1' },
    });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0] ?? '{}')).route).toBe('GET /orders');
  });
});

describe('AuthzObserverGuard', () => {
  it('ignores non-http contexts', () => {
    const observe = jest.fn();
    const guard = new AuthzObserverGuard(new RouteRequirementResolver(new Reflector()), { observe });
    const host = new ExecutionContextHost([{}, {}], OrdersProbeController, OrdersProbeController.prototype.list);
    host.setType('rpc');
    expect(guard.canActivate(host)).toBe(true);
    expect(observe).not.toHaveBeenCalled();
  });
});
