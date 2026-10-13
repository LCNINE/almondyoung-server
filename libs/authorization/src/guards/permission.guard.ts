import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { recordPermissionDecisions } from '../services/permission-decision';
import { PermissionDecider } from '../services/permission-decider';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from '../services/permission-runtime.options';
import { rolesOf } from '../services/request-identity';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';

/**
 * 권한 판정을 «강제»하는 가드. `AUTHZ_ENFORCE=true` 인 서비스에서만 일한다.
 *
 * 꺼져 있는 동안 판정은 `AuthzObserverGuard` 가 계산만 하고 기존 가드가 결과를 정한다(그림자 판정).
 * 켜져 있든 꺼져 있든 «이 라우트에서 받은 권한»을 요청에 낙인으로 남긴다(`permission-decision.ts`) —
 * 핸들러 안의 판정이 역할을 다시 따지지 않고 그 낙인을 본다.
 * 인증 가드 «뒤», 기존 인가 가드 «뒤»에 등록한다 — 켠 뒤에도 기존 가드의 거부가 먼저 나가게 해서
 * 오류 응답 모양이 갑자기 바뀌지 않게 한다.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(RouteRequirementResolver) private readonly resolver: Pick<RouteRequirementResolver, 'resolve'>,
    @Inject(PermissionDecider) private readonly decider: Pick<PermissionDecider, 'decide' | 'grantedAmong'>,
    @Inject(PERMISSION_RUNTIME_OPTIONS) private readonly options: PermissionRuntimeOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const { requirement } = this.resolver.resolve(context);
    const request = context.switchToHttp().getRequest<object>();
    const roles = rolesOf(request);
    if (requirement.kind === 'permission') {
      const granted = this.decider.grantedAmong(requirement.anyOf, roles);
      if (granted) recordPermissionDecisions(request, granted);
    }
    if (!this.options.enforce) return true;
    const verdict = this.decider.decide(requirement, roles);
    if (verdict.allowed) return true;
    switch (verdict.reason) {
      case 'unauthenticated':
        throw new UnauthorizedException();
      case 'unavailable':
        throw new ServiceUnavailableException('Permission data is not loaded yet');
      case 'unclassified':
        throw new ForbiddenException({ message: 'Route has no access policy' });
      case 'missing_permission':
        throw new ForbiddenException({
          message: 'Permission required',
          requiredPermissions: requirement.kind === 'permission' ? requirement.anyOf : [],
        });
    }
  }
}
