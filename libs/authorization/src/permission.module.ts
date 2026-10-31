import { DynamicModule, Global, Module, ModuleMetadata, Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PermissionGuard } from './guards/permission.guard';
import type { OwnerService } from './permissions/permission.types';
import { AuthzDecisionLog } from './services/authz-decision.log';
import { HttpRolePermissionSource } from './services/http-role-permission.source';
import { PermissionCache } from './services/permission-cache';
import { PermissionCheckpoints } from './services/permission-checkpoints';
import { PermissionDecider } from './services/permission-decider';
import {
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_SUMMARY_INTERVAL_MS,
  PERMISSION_RUNTIME_OPTIONS,
  PermissionRuntimeOptions,
} from './services/permission-runtime.options';
import { RolePermissionSource } from './services/role-permission-source';
import { RouteRequirementResolver } from './services/route-requirement.resolver';
import { PermissionTenancy, ServedTenantGate } from './services/served-tenant-gate';
import { requireServedTenant, TENANCY_ENV, TenancyConfig } from '@app/tenancy';

export interface PermissionModuleOptions {
  /** 지표·로그의 service 라벨. */
  readonly service: OwnerService;
  /**
   * 앱이 테넌트를 어떻게 섬기나. 기본값은 없다 — `served-tenant` 면 앱 설정 T(`SERVED_TENANT_ID`)를 목록과 대조하고,
   * 없거나 목록에 없으면 기동을 거부한다. 어느 앱이 무엇을 선언하는지는 `scripts/security/permission-wiring.spec.ts`.
   */
  readonly tenancy: PermissionTenancy;
  /** 기본은 user-service HTTP. user-service 자신만 DB 소스를 넘긴다. */
  readonly source?: Type<RolePermissionSource>;
  /** source 의 의존성을 가진 모듈. */
  readonly imports?: ModuleMetadata['imports'];
}

const EXPORTED = [
  PermissionCache,
  PermissionDecider,
  RouteRequirementResolver,
  AuthzDecisionLog,
  PermissionGuard,
  PermissionCheckpoints,
];

/**
 * 권한 판정 런타임. 가드의 «등록 순서»는 이 모듈이 정하지 않는다 — APP_GUARD 는 앱 루트
 * 모듈의 providers 순서대로 돌므로 각 앱이 직접 적는다(`scripts/security/permission-wiring.spec.ts`).
 */
@Global()
@Module({})
export class PermissionModule {
  static forRoot(options: PermissionModuleOptions): DynamicModule {
    return {
      module: PermissionModule,
      imports: [ConfigModule, ...(options.imports ?? [])],
      providers: [
        {
          provide: PERMISSION_RUNTIME_OPTIONS,
          inject: [ConfigService],
          useFactory: (config: ConfigService): PermissionRuntimeOptions => ({
            service: options.service,
            refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
            retryBaseMs: DEFAULT_RETRY_BASE_MS,
            summaryIntervalMs: DEFAULT_SUMMARY_INTERVAL_MS,
          }),
        },
        { provide: RolePermissionSource, useClass: options.source ?? HttpRolePermissionSource },
        {
          provide: ServedTenantGate,
          inject: [ConfigService, { token: TenancyConfig, optional: true }],
          useFactory: (config: ConfigService, tenancy?: TenancyConfig): ServedTenantGate => {
            if (options.tenancy === 'per-token') return ServedTenantGate.perToken();
            if (!tenancy)
              throw new Error(`${options.service}: «T 만 섬김» 앱은 루트 모듈이 TenancyModule 을 import 해야 한다`);
            const served = requireServedTenant(tenancy.tenants, config.get<string>(TENANCY_ENV.servedTenantId));
            return new ServedTenantGate({ service: options.service, tenantId: served.id, gateMode: tenancy.gateMode });
          },
        },
        ...EXPORTED,
      ],
      // 옵션 토큰도 내보낸다 — 앱이 PermissionGuard 를 자기 모듈의 APP_GUARD 로 걸면 거기서 풀린다.
      exports: [...EXPORTED, ServedTenantGate, PERMISSION_RUNTIME_OPTIONS],
    };
  }
}
