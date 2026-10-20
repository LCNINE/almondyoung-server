import { ExecutionContext, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './permission-runtime.options';
import { RouteRequirementResolver } from './route-requirement.resolver';

/**
 * 이 요청을 «누가» 판정하는가. `AUTHZ_ENFORCE=true` 인 서비스의 권한 분류 라우트는 새 권한 판정(`PermissionGuard`)만
 * 결정하고, 옛 인가 가드는 이 객체에 물어 물러난다. 열린 라우트(고객·공개·키·내부)와 분류 없는 라우트는 옛 가드가
 * 계속 판정한다 — 분류 없는 라우트는 `PermissionGuard` 가 따로 거부한다.
 */
@Injectable()
export class PermissionAuthority implements OnModuleInit {
  private readonly logger = new Logger(PermissionAuthority.name);

  constructor(
    @Inject(RouteRequirementResolver) private readonly resolver: Pick<RouteRequirementResolver, 'resolve'>,
    @Inject(PERMISSION_RUNTIME_OPTIONS) private readonly options: PermissionRuntimeOptions,
  ) {}

  onModuleInit(): void {
    this.logger.log(`authz mode: ${this.options.enforce ? 'enforce' : 'shadow'} (${this.options.service})`);
  }

  get enforced(): boolean {
    return this.options.enforce;
  }

  decides(context: ExecutionContext): boolean {
    if (!this.options.enforce || context.getType() !== 'http') return false;
    return this.resolver.resolve(context).requirement.kind === 'permission';
  }
}
