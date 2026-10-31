import { CallHandler, ExecutionContext, ForbiddenException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Counter, register } from 'prom-client';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY, IS_SERVICE_KEY_ROUTE_KEY } from '@app/authorization';
import { resolveRequestTenant, TenancyConfig, tenantHeaderOf } from '@app/tenancy';
import { REQUEST_TENANT_KEY, type RequestTenantId } from './request-tenant';

// ① 의 셈. 입구마다 0 에 멈춰야 ② 로 바꾼다 — token 은 클레임 전 토큰이 사라지면, service 는 내부 키 호출자
// (user-service 근태)가 헤더를 실으면 0 이 된다.
const untenanted = new Counter({
  name: 'ai_untenanted_requests_total',
  help: 'ai requests whose tenant is unknown (token without tenant claim, internal-key call without tenant header)',
  labelNames: ['entry'],
  registers: [register],
});

/**
 * ai 요청 문. 요청의 테넌트를 정해 요청 객체에 싣는다 — 대화 목록·열기가 그 테넌트로 거르고, 새 대화·업로드 추적이 행에 적는다.
 * 판정은 core·file-service 와 같은 `resolveRequestTenant` 다(토큰이 이기고, 헤더≠토큰·목록 밖은 두 모드 모두 403).
 *
 * - 사람 토큰 라우트(어시스턴트·상품설명): 토큰의 `tenant`.
 * - 내부 키 라우트(`@InternalOnly`, 근태 검토): 테넌트 헤더. 그 테넌트로 file-service 를 부른다.
 * - `@Public`(헬스): 판정 밖.
 * - 모르는 테넌트: ①(warn) 통과 + 셈, ②(reject) 403.
 *
 * 가드가 아니라 인터셉터인 이유는 core 와 같다 — 인증·내부 키 가드가 끝난 뒤에 판정해야 키를 통과한 호출만 센다.
 */
@Injectable()
export class AiRequestTenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AiRequestTenantInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: TenancyConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const targets = [context.getHandler(), context.getClass()];
    const service = this.reflector.getAllAndOverride<boolean>(IS_SERVICE_KEY_ROUTE_KEY, targets) === true;
    if (!service && this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<{ user?: object | null; [REQUEST_TENANT_KEY]?: RequestTenantId }>();
    const entry = service ? 'service' : 'token';
    const verdict = resolveRequestTenant(
      { entry, user: request.user, header: tenantHeaderOf(request) },
      this.tenancy.tenants,
    );

    if ('tenant' in verdict) {
      request[REQUEST_TENANT_KEY] = verdict.tenant;
      return next.handle();
    }

    if (this.tenancy.gateMode === 'reject') {
      throw new ForbiddenException(
        entry === 'token' ? '테넌트가 없는 토큰입니다. 다시 로그인해 주세요.' : '테넌트 헤더가 없습니다.',
      );
    }
    untenanted.inc({ entry });
    this.logger.warn(`untenanted ${entry} request route=${context.getClass().name}.${context.getHandler().name}`);
    request[REQUEST_TENANT_KEY] = null;
    return next.handle();
  }
}
