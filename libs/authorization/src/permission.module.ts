import { DynamicModule, Global, Module, ModuleMetadata, Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthzObserverGuard } from './guards/authz-observer.guard';
import { PermissionGuard } from './guards/permission.guard';
import { AuthzShadowInterceptor } from './interceptors/authz-shadow.interceptor';
import type { OwnerService } from './permissions/permission.types';
import { AuthzShadowRecorder } from './services/authz-shadow.recorder';
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

export interface PermissionModuleOptions {
  /** 지표·로그의 service 라벨. */
  readonly service: OwnerService;
  /** 기본은 user-service HTTP. user-service 자신만 DB 소스를 넘긴다. */
  readonly source?: Type<RolePermissionSource>;
  /** source 의 의존성을 가진 모듈. */
  readonly imports?: ModuleMetadata['imports'];
}

const EXPORTED = [
  PermissionCache,
  PermissionDecider,
  RouteRequirementResolver,
  AuthzShadowRecorder,
  AuthzObserverGuard,
  AuthzShadowInterceptor,
  PermissionGuard,
  PermissionCheckpoints,
];

/**
 * 권한 판정 런타임. 가드·인터셉터의 «등록 순서»는 이 모듈이 정하지 않는다 — APP_GUARD 는 앱 루트
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
            enforce: config.get<string>('AUTHZ_ENFORCE') === 'true',
            refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
            retryBaseMs: DEFAULT_RETRY_BASE_MS,
            summaryIntervalMs: DEFAULT_SUMMARY_INTERVAL_MS,
          }),
        },
        { provide: RolePermissionSource, useClass: options.source ?? HttpRolePermissionSource },
        ...EXPORTED,
      ],
      // 옵션 토큰도 내보낸다 — 앱이 PermissionGuard 를 자기 모듈의 APP_GUARD 로 걸면 거기서 풀린다.
      exports: [...EXPORTED, PERMISSION_RUNTIME_OPTIONS],
    };
  }
}
