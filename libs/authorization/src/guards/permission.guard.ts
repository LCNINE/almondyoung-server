import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthzDecisionLog } from '../services/authz-decision.log';
import { recordPermissionDecisions } from '../services/permission-decision';
import { PermissionDecider } from '../services/permission-decider';
import { methodOf, rolesOf } from '../services/request-identity';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';
import { ServedTenantGate } from '../services/served-tenant-gate';

/**
 * 라우트 인가를 결정하는 가드. 권한 분류 라우트는 여기서만 판정하고, 설정으로 끌 수 없다.
 *
 * 거부 사유별 상태: 미인증 401, 권한 사본 없음 503, 분류 없음 403, 권한 없음 403(`requiredPermissions`).
 * 통과하면 «이 라우트에서 받은 권한»을 요청에 낙인으로 남긴다(`permission-decision.ts`) — 핸들러 안의 판정이
 * 역할을 다시 따지지 않고 그 낙인을 본다. 인증 가드 «뒤»에 등록한다(사용자를 읽으므로).
 * 분류가 있는 라우트의 판정은 결과와 함께 판정 기록(`AuthzDecisionLog`)에 남긴다.
 * «T 만 섬김» 앱이면 권한보다 먼저 공유 서비스 문(`ServedTenantGate`)을 지난다 — 남의 테넌트 토큰은 권한이 있어도 403.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(RouteRequirementResolver) private readonly resolver: Pick<RouteRequirementResolver, 'resolve'>,
    @Inject(PermissionDecider) private readonly decider: Pick<PermissionDecider, 'decide' | 'grantedAmong'>,
    @Inject(AuthzDecisionLog) private readonly log: Pick<AuthzDecisionLog, 'record'>,
    @Inject(ServedTenantGate) private readonly tenantGate: Pick<ServedTenantGate, 'admitToken' | 'admitService'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const { requirement, tenantEntry, path } = this.resolver.resolve(context);
    const request = context.switchToHttp().getRequest<object>();
    if (tenantEntry === 'token') this.tenantGate.admitToken(request, path);
    if (tenantEntry === 'service') this.tenantGate.admitService(request, context.switchToHttp().getResponse(), path);
    const roles = rolesOf(request);
    if (requirement.kind === 'permission') {
      const granted = this.decider.grantedAmong(requirement.anyOf, roles);
      if (granted) recordPermissionDecisions(request, granted);
    }
    const verdict = this.decider.decide(requirement, roles);
    if (requirement.kind !== 'open') {
      const required = requirement.kind === 'permission' ? requirement.anyOf : [];
      this.log.record('route', `${methodOf(request)} ${path}`, verdict, required, roles);
    }
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
