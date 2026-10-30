import type { JwtPayload } from '@app/authorization';
import { TenancyConfig } from '@app/tenancy';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Counter, register } from 'prom-client';
import { SERVED_TENANT_ID } from './served-tenant';

const SERVED_TENANT_DATA = 'user-service:served-tenant-data';

/**
 * 이 컨트롤러(또는 라우트)의 데이터는 T 의 것이다(고객·근태 등) — 토큰 테넌트가 T 일 때만 답한다. 표시 없는 것은 계정·토큰·권한
 * 처럼 모든 테넌트의 일이고, 어느 쪽인지는 `served-tenant-classification.spec.ts` 가 컨트롤러마다 묻는다.
 */
export const ServedTenantData = () => SetMetadata(SERVED_TENANT_DATA, true);

// warn 모드의 «셈». `tenant` 클레임 도입 전에 나간 OAuth 액세스 토큰이 남아 있는 동안(액세스 토큰 수명)만 0 이 아니어야
// 한다 — reject 로 바꾸기 전에 이 값이 멈췄는지 본다.
const untenanted = new Counter({
  name: 'user_service_untenanted_token_requests_total',
  help: 'Requests to served-tenant data carrying a token without a tenant claim',
  labelNames: ['controller'],
  registers: [register],
});

/**
 * 역할 정의는 전역이라 권한 키만으로는 테넌트 2 토큰을 못 막는다. 인증 가드 뒤, 권한 가드 앞에 둔다.
 * 토큰 테넌트는 `JwtAccessStrategy` 가 채운다(옛 내부 토큰은 T 의 부여만 실어 발급하므로 T 로 본다).
 */
@Injectable()
export class ServedTenantGuard implements CanActivate {
  private readonly logger = new Logger(ServedTenantGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(SERVED_TENANT_ID) private readonly servedTenantId: string,
    private readonly tenancy: TenancyConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const controller = context.getClass();
    if (!this.reflector.getAllAndOverride<boolean>(SERVED_TENANT_DATA, [context.getHandler(), controller])) return true;

    const user = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    if (!user) return true; // 토큰 없이 연 @Public 라우트 — 토큰이 없으니 테넌트를 넘길 것도 없다.

    if (user.tenant === this.servedTenantId) return true;
    if (user.tenant !== undefined) throw new ForbiddenException('이 테넌트에서는 쓸 수 없는 기능입니다.');

    if (this.tenancy.gateMode === 'reject')
      throw new ForbiddenException('테넌트가 없는 토큰입니다. 다시 로그인해 주세요.');
    untenanted.inc({ controller: controller.name });
    this.logger.warn(`untenanted token on served-tenant data controller=${controller.name}`);
    return true;
  }
}
