import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { register } from 'prom-client';
import { ServedTenantData, ServedTenantGuard } from './served-tenant.guard';

/**
 * user-service 안의 고객·근태 데이터는 T(테넌트 1) 의 것이다. 역할 정의가 전역이라 권한 키만으로는 테넌트 2 토큰을 못 막는다 —
 * 테넌트 2 에서 `customer.read` 를 가진 역할을 받으면 그대로 통과한다. 그래서 «T 데이터» 컨트롤러는 토큰 테넌트를 따로 본다.
 */
describe('ServedTenantGuard — «T 데이터» 컨트롤러는 토큰 테넌트가 T 일 때만 답한다', () => {
  @ServedTenantData()
  class CustomerController {
    list() {}
  }
  class AccountController {
    me() {}
  }
  class MixedController {
    me() {}
    @ServedTenantData()
    findCustomer() {}
  }

  const context = (controller: new () => object, user: object | undefined, handler?: string): ExecutionContext => {
    const proto = controller.prototype as Record<string, unknown>;
    const method = proto[handler ?? Object.getOwnPropertyNames(proto)[1]];
    return {
      getType: () => 'http',
      getClass: () => controller,
      getHandler: () => method,
      switchToHttp: () => ({ getRequest: () => ({ user, url: '/x' }) }),
    } as unknown as ExecutionContext;
  };

  const guard = (mode: 'warn' | 'reject') => new ServedTenantGuard(new Reflector(), '1', { gateMode: mode } as never);

  const untenantedCount = async () => {
    const metric = await register.getSingleMetric('user_service_untenanted_token_requests_total')?.get();
    return metric?.values.reduce((sum, v) => sum + v.value, 0) ?? 0;
  };

  it.each(['warn', 'reject'] as const)('[%s] 토큰 테넌트가 T 면 통과', (mode) => {
    expect(guard(mode).canActivate(context(CustomerController, { id: 'u', roles: [], tenant: '1' }))).toBe(true);
  });

  it.each(['warn', 'reject'] as const)('[%s] 토큰 테넌트가 T 가 아니면 403', (mode) => {
    expect(() =>
      guard(mode).canActivate(context(CustomerController, { id: 'u', roles: ['admin'], tenant: '2' })),
    ).toThrow(ForbiddenException);
  });

  it('[warn] 테넌트 없는 토큰(`tenant` 클레임 도입 전 발급)은 통과시키고 센다', async () => {
    const before = await untenantedCount();

    expect(guard('warn').canActivate(context(CustomerController, { id: 'u', roles: [] }))).toBe(true);

    expect(await untenantedCount()).toBe(before + 1);
  });

  it('[reject] 테넌트 없는 토큰은 403', () => {
    expect(() => guard('reject').canActivate(context(CustomerController, { id: 'u', roles: [] }))).toThrow(
      ForbiddenException,
    );
  });

  it('토큰 없는 요청(@Public)은 이 문이 보지 않는다', () => {
    expect(guard('reject').canActivate(context(CustomerController, undefined))).toBe(true);
  });

  it('표시 없는 컨트롤러(계정·토큰·권한 — 모든 테넌트의 일)는 테넌트 2 토큰도 통과', () => {
    expect(guard('reject').canActivate(context(AccountController, { id: 'u', roles: [], tenant: '2' }))).toBe(true);
  });

  it('라우트에만 단 표시도 그 라우트를 막는다 — 같은 컨트롤러의 계정 라우트는 그대로', () => {
    const tenantTwo = { id: 'u', roles: ['admin'], tenant: '2' };
    expect(() => guard('reject').canActivate(context(MixedController, tenantTwo, 'findCustomer'))).toThrow(
      ForbiddenException,
    );
    expect(guard('reject').canActivate(context(MixedController, tenantTwo, 'me'))).toBe(true);
  });
});
