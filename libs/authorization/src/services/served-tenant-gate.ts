import { tenantHeaderOf, type TenantGateMode } from '@app/tenancy';
import { ForbiddenException, Logger } from '@nestjs/common';
import { Counter, register } from 'prom-client';
import { rawResponseOf } from './request-identity';

/**
 * 앱이 테넌트를 어떻게 섬기나 — `PermissionModule.forRoot` 의 필수 선언. 기본값은 없다.
 * - served-tenant : 한 테넌트 T 만 섬긴다(1단계의 공유 서비스 일곱 개). 토큰·헤더의 테넌트가 T 가 아니면 거절한다.
 * - per-token     : 토큰 테넌트마다 답한다(core·user-service·ai·file-service). 이 문은 아무것도 하지 않는다.
 */
export type PermissionTenancy = 'served-tenant' | 'per-token';

/**
 * user-service 가 로그인 세션(쇼핑몰·auth-web)에 내주는 옛 내부 토큰의 audience. 이 토큰에는 `tenant` 가 없지만
 * user-service 가 자기 T 의 부여만 실어 발급하고, 공유 서비스의 T 는 그 T 를 그대로 받는다(SST 의 `servedTenantEnv`,
 * 로컬 `E2E_SERVED_TENANT_ID`). 그래서 이 문에선 T 의 토큰이다. user-service 의 `INTERNAL_TOKEN_AUDIENCE` 가 이 값을 쓴다.
 */
export const INTERNAL_SESSION_TOKEN_AUDIENCE = 'user-service-internal';

export interface ServedTenant {
  readonly service: string;
  readonly tenantId: string;
  readonly gateMode: TenantGateMode;
}

// warn 모드의 «셈». 토큰 입구는 `tenant` 클레임 전에 나간 토큰이 사라지면(액세스 토큰 수명), 서비스 키 입구는 호출자가
// 모두 헤더를 실으면 0 에 멈춰야 한다 — reject 로 바꾸기 전에 이 값을 본다.
const untenanted = new Counter({
  name: 'served_tenant_untenanted_requests_total',
  help: 'Requests to a served-tenant app whose tenant is unknown (token without tenant claim, service call without tenant header)',
  labelNames: ['service', 'entry'],
  registers: [register],
});

type Entry = 'token' | 'service';

function userOf(request: unknown): object | undefined {
  if (typeof request !== 'object' || request === null || !('user' in request)) return undefined;
  const user: unknown = request.user;
  return typeof user === 'object' && user !== null ? user : undefined;
}

/**
 * 공유 서비스 문. 앱 단위로 한 번 판정한다 — 라우트·권한 키마다 손으로 달지 않는다 — 하나 빠뜨리면 곧 누출이다.
 * 토큰 입구는 `PermissionGuard`(권한·고객 라우트)와 `OptionalAuthGuard`(토큰이 온 선택 인증)가, 서비스 키 입구는
 * `PermissionGuard` 가 `@InternalOnly`·`@ServiceKeyRoute` 표식을 보고 부른다. 머천트 키·`@Public` 은 T 의
 * 자격증명·공개 콘텐츠라 지나간다.
 */
export class ServedTenantGate {
  private readonly logger = new Logger(ServedTenantGate.name);

  /** null = «토큰 테넌트별» 앱 — 문이 없다. */
  constructor(private readonly served: ServedTenant | null) {}

  static perToken(): ServedTenantGate {
    return new ServedTenantGate(null);
  }

  /** 사람 토큰 입구. 토큰이 없으면(인증 가드가 머천트 키로 통과시킨 경우 등) 판정할 토큰도 없다. */
  admitToken(request: unknown, route: string): void {
    if (!this.served) return;
    const user = userOf(request);
    if (!user) return;

    const audience: unknown = 'aud' in user ? (Array.isArray(user.aud) ? user.aud[0] : user.aud) : undefined;
    const claim: unknown = 'tenant' in user ? user.tenant : undefined;
    const tokenTenant =
      audience === INTERNAL_SESSION_TOKEN_AUDIENCE
        ? this.served.tenantId
        : typeof claim === 'string' && claim !== ''
          ? claim
          : undefined;

    // 토큰이 이긴다 — 헤더는 토큰 테넌트를 바꾸지 못하고, 다르면 누가 문을 고르려 한 것이다.
    const header = tenantHeaderOf(request);
    if (header !== undefined && header !== (tokenTenant ?? this.served.tenantId)) {
      throw new ForbiddenException('테넌트 헤더가 토큰의 테넌트와 다릅니다.');
    }
    if (this.admitted(tokenTenant, 'token')) return;
    this.count('token', route);
  }

  /**
   * 서비스 키 입구(내부 키). 헤더가 테넌트를 정한다. 이 문은 라우트의 키 검사보다 «먼저» 돌기 때문에, warn 의 셈은
   * 응답이 성공으로 끝난 것만 센다 — 키를 모르는 호출(스캐너·틀린 키)까지 세면 ② 전환 신호가 0 이 되지 않는다.
   */
  admitService(request: unknown, response: unknown, route: string): void {
    if (!this.served) return;
    if (this.admitted(tenantHeaderOf(request), 'service')) return;
    const raw = rawResponseOf(response);
    if (!raw) return this.count('service', route);
    raw.once('finish', () => {
      if (raw.statusCode < 400) this.count('service', route);
    });
  }

  /** T 면 true(통과). 남의 테넌트는 두 모드 모두, 모르는 테넌트는 reject 에서 403. false = 모르는 테넌트를 warn 에서 통과. */
  private admitted(tenant: string | undefined, entry: Entry): boolean {
    const served = this.served;
    if (!served || tenant === served.tenantId) return true;
    if (tenant !== undefined) throw new ForbiddenException('이 테넌트에서는 쓸 수 없는 기능입니다.');
    if (served.gateMode === 'reject') {
      throw new ForbiddenException(
        entry === 'token' ? '테넌트가 없는 토큰입니다. 다시 로그인해 주세요.' : '테넌트 헤더가 없습니다.',
      );
    }
    return false;
  }

  private count(entry: Entry, route: string): void {
    if (!this.served) return;
    untenanted.inc({ service: this.served.service, entry });
    this.logger.warn(`untenanted ${entry} request service=${this.served.service} route=${route}`);
  }
}
