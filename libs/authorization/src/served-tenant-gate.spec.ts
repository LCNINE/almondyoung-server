import { TENANT_HEADER, TenancyModule } from '@app/tenancy';
import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { register } from 'prom-client';
import { InternalOnly } from './decorators/internal-only.decorator';
import { KeyAuthRoute } from './decorators/key-auth-route.decorator';
import { OptionalAuth } from './decorators/optional-auth.decorator';
import { Public } from './decorators/public.decorator';
import { RequirePermission } from './decorators/require-permission.decorator';
import { ServiceKeyRoute } from './decorators/service-key-route.decorator';
import { StoreRoute } from './decorators/store-route.decorator';
import { OptionalAuthGuard } from './guards/optional-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { PermissionModule } from './permission.module';
import { PermissionCache } from './services/permission-cache';
import { RolePermissionSource, SnapshotFetch } from './services/role-permission-source';
import { INTERNAL_SESSION_TOKEN_AUDIENCE, ServedTenantGate } from './services/served-tenant-gate';

class StubSource extends RolePermissionSource {
  isConfigured(): boolean {
    return false;
  }

  async fetch(): Promise<SnapshotFetch> {
    return { status: 'not_modified' };
  }
}

const TENANT_LIST = JSON.stringify([
  { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'bucket-one', privateBucket: 'bucket-one' },
  { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'bucket-two', privateBucket: 'bucket-two-private' },
]);

const boot = (env: Record<string, string>, tenancy: 'served-tenant' | 'per-token' = 'served-tenant') =>
  Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, ignoreEnvVars: true, load: [() => env] }),
      TenancyModule,
      PermissionModule.forRoot({ service: 'wallet', source: StubSource, tenancy }),
    ],
  }).compile();

/**
 * 공유 서비스 문의 계약. «T 만 섬김» 앱은 `forRoot` 가 T 를 받고, 토큰을 받는 입구에서 토큰 테넌트 ≠ T 면 403,
 * 서비스 키 입구는 테넌트 헤더가 T 여야 한다. 테넌트를 모르는 입력은 warn 이면 세고 통과, reject 면 거절.
 */
describe('공유 서비스 문 — 부팅', () => {
  it('T 가 목록에 있으면 뜬다', async () => {
    await expect(boot({ TENANT_LIST, TENANT_GATE_MODE: 'warn', SERVED_TENANT_ID: '1' })).resolves.toBeDefined();
  });

  it('T 가 없으면 기동하지 않는다 — 기본 테넌트는 없다', async () => {
    await expect(boot({ TENANT_LIST, TENANT_GATE_MODE: 'warn' })).rejects.toThrow(/SERVED_TENANT_ID 가 없다/);
  });

  it('T 가 목록에 없으면 기동하지 않는다', async () => {
    await expect(boot({ TENANT_LIST, TENANT_GATE_MODE: 'warn', SERVED_TENANT_ID: '9' })).rejects.toThrow(
      /«9» 가 테넌트 목록에 없다/,
    );
  });

  it('«토큰 테넌트별» 앱은 T 없이 뜬다', async () => {
    await expect(boot({ TENANT_LIST, TENANT_GATE_MODE: 'warn' }, 'per-token')).resolves.toBeDefined();
  });
});

class ReadySource extends RolePermissionSource {
  isConfigured(): boolean {
    return true;
  }

  async fetch(): Promise<SnapshotFetch> {
    return { status: 'loaded', snapshot: { version: 'v1', roles: new Map([['staff', ['order.order.read']]]) } };
  }
}

class Routes {
  @RequirePermission('order.order.read')
  staff(): void {}

  @StoreRoute()
  store(): void {}

  @OptionalAuth()
  optional(): void {}

  @InternalOnly()
  internal(): void {}

  @Public()
  @ServiceKeyRoute()
  serviceKey(): void {}

  @KeyAuthRoute()
  merchant(): void {}

  @Public()
  open(): void {}
}

type Handler = keyof Routes;
interface Request {
  user?: Record<string, unknown>;
  headers: Record<string, string>;
}

/** 응답이 끝난 상태 코드를 흉내 낸다 — 서비스 키 입구의 셈은 키 검사가 끝난 응답을 보고 센다. */
const responseFinishing = (statusCode: number) => {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  return {
    response,
    finish: () => {
      response.statusCode = statusCode;
      response.emit('finish');
    },
  };
};

const staff = (claims: Record<string, unknown>) => ({ sub: 'u', userId: 'u', roles: ['staff'], ...claims });

async function gateFor(gateMode: 'warn' | 'reject', tenancy: 'served-tenant' | 'per-token' = 'served-tenant') {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => ({ TENANT_LIST, TENANT_GATE_MODE: gateMode, SERVED_TENANT_ID: '1' })],
      }),
      TenancyModule,
      PermissionModule.forRoot({ service: 'wallet', source: ReadySource, tenancy }),
    ],
  }).compile();
  await module.get(PermissionCache).refresh();
  const guard = module.get(PermissionGuard);
  const optional = new OptionalAuthGuard(module.get(ServedTenantGate));

  /** 전역 가드(인증 → 권한) 뒤 라우트 가드(선택 인증)까지 — 앱이 거는 순서 그대로. 내부 키 자체는 여기서 재지 않는다. */
  return async (handler: Handler, request: Request, response: object = {}): Promise<boolean> => {
    const context = new ExecutionContextHost([request, response], Routes, Routes.prototype[handler]);
    context.setType('http');
    if (!guard.canActivate(context)) return false;
    if (handler !== 'optional') return true;
    // passport 는 재지 않는다 — 토큰 해석은 요청에 이미 실린 user 로 대신한다.
    jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockResolvedValueOnce(true);
    return optional.canActivate(context);
  };
}

const untenantedCount = async (entry: 'token' | 'service'): Promise<number> => {
  const metric = await register.getSingleMetric('served_tenant_untenanted_requests_total')?.get();
  return metric?.values.find((v) => v.labels.entry === entry && v.labels.service === 'wallet')?.value ?? 0;
};

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe.each(['warn', 'reject'] as const)('공유 서비스 문 — 두 모드 공통 (%s)', (mode) => {
  it.each(['staff', 'store', 'optional'] as const)('토큰 입구 %s: 토큰 테넌트가 T 면 통과', async (handler) => {
    const pass = await gateFor(mode);
    await expect(pass(handler, { user: staff({ tenant: '1' }), headers: {} })).resolves.toBe(true);
  });

  it.each(['staff', 'store', 'optional'] as const)('토큰 입구 %s: 토큰 테넌트가 T 가 아니면 403', async (handler) => {
    const pass = await gateFor(mode);
    await expect(pass(handler, { user: staff({ tenant: '2' }), headers: {} })).rejects.toThrow(ForbiddenException);
  });

  it('옛 내부 토큰(쇼핑몰·auth-web 세션)은 tenant 가 없어도 T 의 토큰이다', async () => {
    const pass = await gateFor(mode);
    const session = staff({ aud: INTERNAL_SESSION_TOKEN_AUDIENCE });
    await expect(pass('store', { user: session, headers: {} })).resolves.toBe(true);
    await expect(pass('store', { user: session, headers: { [TENANT_HEADER]: '2' } })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('토큰이 이긴다 — 헤더가 T 여도 토큰 테넌트가 다르면 403, 헤더가 토큰과 다르면 403', async () => {
    const pass = await gateFor(mode);
    await expect(pass('staff', { user: staff({ tenant: '2' }), headers: { [TENANT_HEADER]: '1' } })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(pass('staff', { user: staff({ tenant: '1' }), headers: { [TENANT_HEADER]: '2' } })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(pass('staff', { user: staff({ tenant: '1' }), headers: { [TENANT_HEADER]: '1' } })).resolves.toBe(
      true,
    );
  });

  it.each(['internal', 'serviceKey'] as const)('서비스 키 입구 %s: 헤더가 T 면 통과, 다르면 403', async (handler) => {
    const pass = await gateFor(mode);
    await expect(pass(handler, { headers: { [TENANT_HEADER]: '1' } })).resolves.toBe(true);
    await expect(pass(handler, { headers: { [TENANT_HEADER]: '2' } })).rejects.toThrow(ForbiddenException);
  });

  it('토큰 없이 온 선택 인증·머천트 키·공개 라우트는 그대로다', async () => {
    const pass = await gateFor(mode);
    for (const handler of ['optional', 'merchant', 'open'] as const) {
      await expect(pass(handler, { headers: {} })).resolves.toBe(true);
    }
  });

  it('«토큰 테넌트별» 앱에는 문이 없다', async () => {
    const pass = await gateFor(mode, 'per-token');
    await expect(pass('staff', { user: staff({ tenant: '2' }), headers: {} })).resolves.toBe(true);
    await expect(pass('internal', { headers: {} })).resolves.toBe(true);
  });
});

describe('공유 서비스 문 — 테넌트를 모르는 입력', () => {
  it('warn: 테넌트 없는 토큰·헤더 없는 서비스 호출을 거절하지 않고 센다', async () => {
    const pass = await gateFor('warn');
    const [tokenBefore, serviceBefore] = [await untenantedCount('token'), await untenantedCount('service')];
    for (const handler of ['staff', 'store', 'optional'] as const) {
      await expect(pass(handler, { user: staff({}), headers: {} })).resolves.toBe(true);
    }
    const served = [responseFinishing(200), responseFinishing(201)];
    await expect(pass('internal', { headers: {} }, served[0].response)).resolves.toBe(true);
    await expect(pass('serviceKey', { headers: {} }, served[1].response)).resolves.toBe(true);
    served.forEach((r) => r.finish());
    expect(await untenantedCount('token')).toBe(tokenBefore + 3);
    expect(await untenantedCount('service')).toBe(serviceBefore + 2);
  });

  // 키를 모르는 호출(스캐너·틀린 키)까지 세면 «호출자가 다 헤더를 실었다»는 신호가 영영 0 이 되지 않는다.
  it('warn: 헤더 없는 서비스 호출은 키 검사를 통과해 답한 것만 센다', async () => {
    const pass = await gateFor('warn');
    const before = await untenantedCount('service');
    const refused = [responseFinishing(401), responseFinishing(403)];
    await expect(pass('internal', { headers: {} }, refused[0].response)).resolves.toBe(true);
    await expect(pass('serviceKey', { headers: {} }, refused[1].response)).resolves.toBe(true);
    expect(await untenantedCount('service')).toBe(before);
    refused.forEach((r) => r.finish());
    expect(await untenantedCount('service')).toBe(before);
  });

  it('토큰에 테넌트가 없어도 헤더가 남의 테넌트면 403 — 헤더로 남의 테넌트를 고를 수 없다', async () => {
    const pass = await gateFor('warn');
    await expect(pass('staff', { user: staff({}), headers: { [TENANT_HEADER]: '2' } })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('reject: 테넌트 없는 토큰·헤더 없는 서비스 호출을 403 으로 거절한다', async () => {
    const pass = await gateFor('reject');
    for (const handler of ['staff', 'store', 'optional'] as const) {
      await expect(pass(handler, { user: staff({}), headers: {} })).rejects.toThrow(ForbiddenException);
    }
    await expect(pass('internal', { headers: {} })).rejects.toThrow(ForbiddenException);
    await expect(pass('serviceKey', { headers: {} })).rejects.toThrow(ForbiddenException);
  });
});
