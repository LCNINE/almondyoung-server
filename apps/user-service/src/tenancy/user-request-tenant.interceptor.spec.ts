import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { lastValueFrom, of } from 'rxjs';
import { Public } from '@app/authorization';
import { EventTenantStamp } from '@app/events';
import { parseTenantList, TENANT_CONTEXT_KEY, TenancyConfig } from '@app/tenancy';
import { UserRequestTenantInterceptor } from './user-request-tenant.interceptor';

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'bucket-one', privateBucket: 'bucket-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'bucket-two-pub', privateBucket: 'bucket-two-priv' },
  ]),
);
const SECRET = 'auth-web-secret';

class AuthController {
  changePassword() {}
}
class SignupController {
  @Public()
  callback() {}
}

/**
 * 인터셉터가 요청 맥락(`TENANT_CONTEXT_KEY`)에 세운 테넌트를, 같은 요청 안의 직접 발행이 봉투에 찍는다.
 * 찍기는 운영과 같은 `EventTenantStamp`(맥락 → 앱 설정 T = 1)다.
 */
describe('UserRequestTenantInterceptor — user-service 이벤트 봉투의 테넌트', () => {
  const cls: ClsService = ClsServiceManager.getClsService();
  const interceptor = new UserRequestTenantInterceptor(
    new Reflector(),
    new TenancyConfig(tenants, 'warn'),
    cls,
    new ConfigService({ OAUTH_INTERNAL_SECRET: SECRET }),
  );
  const stamp = new EventTenantStamp({
    contextTenant: () => (cls.isActive() ? cls.get<string | undefined>(TENANT_CONTEXT_KEY) : undefined),
    servedTenantId: '1',
    outboxTenantId: '1',
    gateMode: 'warn',
  });

  const context = (
    controller: new () => object,
    request: { user?: object; headers: Record<string, string> },
  ): ExecutionContext => {
    const proto = controller.prototype as Record<string, unknown>;
    const handler = proto[Object.getOwnPropertyNames(proto)[1]];
    return {
      getType: () => 'http',
      getClass: () => controller,
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  /** 요청 하나(CLS 저장소 하나) 안에서 핸들러가 발행했을 때 찍히는 테넌트. */
  const stampedTenant = (controller: new () => object, request: { user?: object; headers: Record<string, string> }) =>
    cls.run(() => {
      const next: CallHandler = { handle: () => of(stamp.forDirectPublish()) };
      return lastValueFrom(interceptor.intercept(context(controller, request), next));
    });

  it('테넌트 auth-web 의 첫 로그인 비밀번호 변경(내부 토큰 1 + 보증된 헤더 2)은 2 로 찍힌다', async () => {
    await expect(
      stampedTenant(AuthController, {
        user: { id: 'u1', tenant: '1' },
        headers: { 'x-tenant-id': '2', 'x-internal-secret': SECRET },
      }),
    ).resolves.toBe('2');
  });

  it('쇼핑몰의 비밀번호 변경(내부 토큰 1, 헤더 없음)은 1 로 찍힌다 — 테넌트 1 고객 알림은 그대로', async () => {
    await expect(stampedTenant(AuthController, { user: { id: 'u1', tenant: '1' }, headers: {} })).resolves.toBe('1');
  });

  it('비밀이 틀리면 헤더를 믿지 않는다', async () => {
    await expect(
      stampedTenant(AuthController, {
        user: { id: 'u1', tenant: '1' },
        headers: { 'x-tenant-id': '2', 'x-internal-secret': 'wrong' },
      }),
    ).resolves.toBe('1');
  });

  it('테넌트 2 셸의 관리자 토큰으로 한 일은 2 로 찍힌다', async () => {
    await expect(stampedTenant(AuthController, { user: { id: 'u1', tenant: '2' }, headers: {} })).resolves.toBe('2');
  });

  it('@Public 은 맥락을 세우지 않아 T 로 찍힌다', async () => {
    await expect(stampedTenant(SignupController, { headers: { 'x-tenant-id': '2' } })).resolves.toBe('1');
  });

  it('OAUTH_INTERNAL_SECRET 이 비어 있으면 어떤 헤더도 보증되지 않는다', async () => {
    const noSecret = new UserRequestTenantInterceptor(
      new Reflector(),
      new TenancyConfig(tenants, 'warn'),
      cls,
      new ConfigService({}),
    );
    const tenant = await cls.run(() =>
      lastValueFrom(
        noSecret.intercept(
          context(AuthController, { user: { id: 'u1', tenant: '1' }, headers: { 'x-tenant-id': '2', 'x-internal-secret': '' } }),
          { handle: () => of(stamp.forDirectPublish()) },
        ),
      ),
    );
    expect(tenant).toBe('1');
  });
});
