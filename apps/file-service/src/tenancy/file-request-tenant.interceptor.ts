import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY, IS_SERVICE_KEY_ROUTE_KEY } from '@app/authorization';
import { resolveRequestTenant, TenancyConfig, tenantHeaderOf } from '@app/tenancy';
import { REQUEST_TENANT_KEY, type RequestTenantId } from './request-tenant';

/**
 * file-service 요청 문. 요청의 테넌트를 정해 요청 객체에 싣는다 — 업로드가 행에 적고, 버킷과 직원 예외가 그 값을 본다.
 * 판정은 core 와 같은 `resolveRequestTenant` 다(토큰이 이기고, 헤더≠토큰·목록 밖은 두 모드 모두 403).
 *
 * - 사람·위임 토큰 라우트: 토큰의 `tenant`.
 * - 내부 키 라우트(`@InternalOnly`): 테넌트 헤더.
 * - `@Public`(공개 파일 읽기·로컬 서빙·헬스): 맥락이 없다. 공개 읽기는 파일 행에 적힌 테넌트의 버킷에서 꺼내 준다.
 * - 모르는 테넌트: 두 모드 모두 403. 행의 테넌트는 NOT NULL 이고 기본 테넌트·테넌트 전 버킷이 없어 그 요청이 쓸 자리가 없다
 *   (contract 전 ① 은 통과시키고 DB 기본값 `'1'` 이 받았다).
 *
 * 가드가 아니라 인터셉터인 이유는 core 와 같다 — 인증·내부 키 가드가 끝난 뒤에 판정해야 키를 통과한 호출만 센다.
 */
@Injectable()
export class FileRequestTenantInterceptor implements NestInterceptor {
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

    throw new ForbiddenException(
      entry === 'token' ? '테넌트가 없는 토큰입니다. 다시 로그인해 주세요.' : '테넌트 헤더가 없습니다.',
    );
  }
}
