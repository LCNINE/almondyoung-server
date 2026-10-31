import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  type Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Counter, register } from 'prom-client';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY, IS_SERVICE_KEY_ROUTE_KEY, OptionalAuthGuard } from '@app/authorization';
import {
  resolveRequestTenant,
  TENANT_CONTEXT_KEY,
  TenancyConfig,
  tenantHeaderOf,
  type RequestEntry,
} from '@app/tenancy';
import { TENANT_FREE_KEY } from './tenant-free.decorator';

/** @Public 라우트에서 사람 토큰을 읽는다(전역 인증 가드는 @Public 을 건너뛴다). 틀린·없는 토큰은 «토큰 없음»이다. */
export const PUBLIC_ROUTE_TOKEN = Symbol('PUBLIC_ROUTE_TOKEN');
export interface PublicRouteToken {
  read(context: ExecutionContext): Promise<void>;
}

// ① 의 셈. 입구마다 0 에 멈춰야 ② 로 바꾼다 — token 은 클레임 전 토큰(쇼핑몰 옛 내부 토큰 포함)이 사라지면,
// service 는 내부 키 호출자가 모두 헤더를 실으면, public 은 공개 호출자가 모두 헤더를 실으면 0 이 된다.
const untenanted = new Counter({
  name: 'core_untenanted_requests_total',
  help: 'core requests whose tenant is unknown (token without tenant claim, internal-key or public call without tenant header)',
  labelNames: ['entry'],
  registers: [register],
});

/**
 * core 요청 문. 요청의 테넌트를 정해 CLS 맥락(`TENANT_CONTEXT_KEY`)에 싣는다 — DB 라우터·서비스 간 헤더가 그 값을 읽는다.
 *
 * 가드가 아니라 인터셉터인 이유: 라우트 가드(내부 키 검사, @OptionalAuth 의 토큰 읽기)까지 모두 끝난 뒤에 판정해야
 * 토큰이 이기는 규칙을 지킬 수 있고, ① 의 셈이 키를 통과한 호출만 센다. core 가드는 DB 에 닿지 않는다.
 * 맥락은 요청마다 `mountEventChainContext` 가 연 CLS 저장소에 실린다 — 요청이 끝나면 함께 끝나고 다른 요청으로 새지 않는다.
 *
 * - 틀린 값(토큰≠헤더, 목록 밖 테넌트)은 두 모드 모두 403.
 * - 모르는 테넌트는 ①(warn) 통과 + 셈, ②(reject) 403.
 */
@Injectable()
export class CoreRequestTenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CoreRequestTenantInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: TenancyConfig,
    private readonly cls: ClsService,
    @Inject(PUBLIC_ROUTE_TOKEN) private readonly publicToken: PublicRouteToken,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(TENANT_FREE_KEY, targets)) return next.handle();

    const entry = this.entryOf(targets);
    const request = context.switchToHttp().getRequest<{ user?: object | null }>();
    if (entry === 'public' && request.user === undefined) await this.publicToken.read(context);

    const verdict = resolveRequestTenant(
      { entry, user: request.user, header: tenantHeaderOf(request) },
      this.tenancy.tenants,
    );
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    if ('tenant' in verdict) {
      // 막지 않지만 ① 의 경고 수에 넣는다 — 클레임 없는 토큰을 core 로 보내는 경로(쇼핑몰 공개 조회)를 찾는 셈이다.
      if (verdict.claimlessToken) this.countUntenanted('token', route);
      if (this.cls.isActive()) this.cls.set(TENANT_CONTEXT_KEY, verdict.tenant);
      else if (this.tenancy.gateMode === 'reject') {
        throw new Error('core: 요청에 CLS 맥락이 없다 — main.ts 가 mountEventChainContext 를 불러야 한다');
      }
      return next.handle();
    }

    if (this.tenancy.gateMode === 'reject') {
      throw new ForbiddenException(
        verdict.untenanted === 'token' ? '테넌트가 없는 토큰입니다. 다시 로그인해 주세요.' : '테넌트 헤더가 없습니다.',
      );
    }
    this.countUntenanted(verdict.untenanted, route);
    return next.handle();
  }

  private countUntenanted(entry: RequestEntry, route: string): void {
    untenanted.inc({ entry });
    // ② 에선 모르는 테넌트가 거절되므로 여기 오는 건 @Public 의 클레임 없는 토큰뿐이다 — 요청마다 경고하지 않고 세기만 한다.
    if (this.tenancy.gateMode === 'warn') this.logger.warn(`untenanted ${entry} request route=${route}`);
  }

  private entryOf(targets: Parameters<Reflector['getAllAndOverride']>[1]): RequestEntry {
    if (this.reflector.getAllAndOverride<boolean>(IS_SERVICE_KEY_ROUTE_KEY, targets)) return 'service';
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return 'public';
    return 'token';
  }
}

/**
 * core 루트 모듈의 providers 에 펼친다. 개인정보 표시 제한(`piiMaskingProviders`)보다 뒤에 둔다 — 그쪽이 가장 바깥
 * 인터셉터여야 한다(`permission-wiring.spec`). 맥락은 핸들러 전에 실리므로 그쪽의 기록도 이 테넌트를 본다.
 */
export function coreRequestTenantProviders(): Provider[] {
  return [
    {
      provide: PUBLIC_ROUTE_TOKEN,
      useFactory: (): PublicRouteToken => {
        // 문 없는 «토큰 테넌트별» core 라 ServedTenantGate 를 넘기지 않는다 — 토큰 읽기만 쓴다.
        const guard = new OptionalAuthGuard();
        return { read: async (context) => void (await guard.canActivate(context)) };
      },
    },
    { provide: APP_INTERCEPTOR, useClass: CoreRequestTenantInterceptor },
  ];
}
