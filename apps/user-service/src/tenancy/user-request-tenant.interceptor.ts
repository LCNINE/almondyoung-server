import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY, IS_SERVICE_KEY_ROUTE_KEY } from '@app/authorization';
import { TENANT_CONTEXT_KEY, TenancyConfig, tenantHeaderOf } from '@app/tenancy';
import { requestEventTenant } from './request-event-tenant';
import { isVouchedByAuthWeb } from './vouched-site-tenant';

/**
 * user-service 요청의 테넌트를 CLS 맥락(`TENANT_CONTEXT_KEY`)에 세운다 — 같은 요청 안의 직접 발행이 봉투에 그 테넌트를 찍는다
 * (없으면 앱 설정 T). 그래서 테넌트 2 화면에서 바꾼 비밀번호의 `UserPasswordChanged` 를 T 만 섬기는 notification 이 건너뛴다.
 * 판정은 `requestEventTenant`. 맥락만 세우고 요청을 거절하지 않는다.
 *
 * 맥락 저장소는 요청마다 `mountEventChainContext`(main.ts)가 연다. 가드(인증)가 끝난 뒤라 `request.user` 가 채워져 있다.
 */
@Injectable()
export class UserRequestTenantInterceptor implements NestInterceptor {
  private readonly internalSecret: string | undefined;

  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: TenancyConfig,
    private readonly cls: ClsService,
    config: ConfigService,
  ) {
    this.internalSecret = config.get<string>('OAUTH_INTERNAL_SECRET');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const targets = [context.getHandler(), context.getClass()];
    const service = this.reflector.getAllAndOverride<boolean>(IS_SERVICE_KEY_ROUTE_KEY, targets) === true;
    const entry = service
      ? 'service'
      : this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)
        ? 'public'
        : 'token';

    const request = context
      .switchToHttp()
      .getRequest<{ user?: object | null; headers?: Record<string, string | string[] | undefined> }>();
    const tenant = requestEventTenant(
      {
        entry,
        user: request.user,
        header: tenantHeaderOf(request),
        vouched: isVouchedByAuthWeb(request.headers, this.internalSecret),
      },
      this.tenancy.tenants,
    );
    if (!tenant) return next.handle();
    if (this.cls.isActive()) this.cls.set(TENANT_CONTEXT_KEY, tenant);
    // 맥락 없이 지나가면 봉투가 조용히 T 로 찍힌다 — core 와 같이 ② 에선 배선 누락을 드러낸다.
    else if (this.tenancy.gateMode === 'reject') {
      throw new Error('user-service: 요청에 CLS 맥락이 없다 — main.ts 가 mountEventChainContext 를 불러야 한다');
    }
    return next.handle();
  }
}
