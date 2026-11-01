import { Global, Injectable, Module, Optional } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TenancyConfigError } from './tenancy-config.error';
import { TENANCY_ENV } from './tenancy-env';
import { parseTenantGateMode, requireServedTenant, TenantGateMode } from './tenancy-settings';
import { TENANT_CONTEXT_KEY } from './tenant-context';
import { outboundTenantHeaders } from './tenant-header';
import { parseTenantList, TenantList } from './tenant-list';

/** 부팅 때 한 번 검증한 테넌트 목록과 전환 모드. 문(DB 라우팅·이벤트·권한·파일)이 이것만 주입받는다. */
export class TenancyConfig {
  constructor(
    readonly tenants: TenantList,
    readonly gateMode: TenantGateMode,
  ) {}

  /** 틀린 설정은 전부 모아 한 번에 던진다. */
  static fromEnv(get: (name: string) => string | undefined): TenancyConfig {
    const problems: string[] = [];
    const attempt = <T>(read: () => T): T | undefined => {
      try {
        return read();
      } catch (e) {
        if (!(e instanceof TenancyConfigError)) throw e;
        problems.push(...e.problems);
        return undefined;
      }
    };

    const tenants = attempt(() => parseTenantList(get(TENANCY_ENV.tenantList)));
    const gateMode = attempt(() => parseTenantGateMode(get(TENANCY_ENV.gateMode)));

    if (!tenants || !gateMode) throw new TenancyConfigError('테넌트', problems);

    return new TenancyConfig(tenants, gateMode);
  }
}

/**
 * 공용 HTTP 클라이언트 쪽의 테넌트 헤더. 이벤트 봉투 찍기와 같은 규칙이다: 맥락(요청·메시지) → 앱 설정 T.
 * 다른 서비스를 내부 키로 부르는 곳은 전부 이 헤더를 싣는다(`scripts/security/permission-wiring.spec.ts`).
 * `TenancyModule` 이 전역으로 내보낸다. ClsModule 이 없는 앱(부팅 스크립트 등)은 T 만 쓴다.
 */
@Injectable()
export class OutboundTenant {
  private readonly servedTenantId: string | undefined;

  constructor(
    tenancy: TenancyConfig,
    config: ConfigService,
    @Optional() private readonly cls?: ClsService,
  ) {
    const raw = config.get<string>(TENANCY_ENV.servedTenantId);
    // T 를 적었으면 목록과 대조한다 — 틀린 T 를 헤더로 내보내면 받는 쪽이 모든 호출을 거절한다.
    this.servedTenantId = raw ? requireServedTenant(tenancy.tenants, raw).id : undefined;
  }

  headers(): Record<string, string> {
    return outboundTenantHeaders(this.contextTenant(), this.servedTenantId);
  }

  /**
   * 헤더와 같은 규칙의 테넌트 id(맥락 → T, 둘 다 없으면 undefined). 헤더 대신 서명하는 토큰의 `tenant` 클레임에 싣는다
   * (core·ugc 가 file-service 를 부르는 토큰).
   */
  tenantId(): string | undefined {
    return this.contextTenant() ?? this.servedTenantId;
  }

  private contextTenant(): string | undefined {
    return this.cls?.isActive() ? this.cls.get<string | undefined>(TENANT_CONTEXT_KEY) : undefined;
  }
}

/**
 * 앱 루트 모듈이 import 한다. 목록이나 모드가 틀리면 DI 초기화에서 던져 앱이 뜨지 않는다.
 * 어느 앱이 import 해야 하는지는 `guards/tenancy-wiring.spec.ts` 가 지킨다.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TenancyConfig,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => TenancyConfig.fromEnv((name) => config.get<string>(name)),
    },
    OutboundTenant,
  ],
  exports: [TenancyConfig, OutboundTenant],
})
export class TenancyModule {}
