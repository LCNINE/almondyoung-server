import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TenancyConfigError } from './tenancy-config.error';
import { TENANCY_ENV } from './tenancy-env';
import { parseTenantGateMode, TenantGateMode } from './tenancy-settings';
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
  ],
  exports: [TenancyConfig],
})
export class TenancyModule {}
