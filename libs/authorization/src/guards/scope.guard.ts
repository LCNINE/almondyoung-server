import { Injectable, CanActivate, ExecutionContext, Inject, Logger, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator';
import { AuthorizationService } from '../services/authorization.service';
import { PermissionAuthority } from '../services/permission-authority';

export const SCOPE_AUTHORIZATION_DECISION_BRAND: unique symbol = Symbol('scope-authorization-decision');
const REQUEST_SCOPE_DECISIONS: unique symbol = Symbol('request-scope-decisions');

export interface ScopeAuthorizationDecision {
  readonly scope: string;
  readonly granted: true;
  readonly [SCOPE_AUTHORIZATION_DECISION_BRAND]: true;
}

interface ScopeAuthorizedRequest {
  user?: { roles?: string[] };
  [REQUEST_SCOPE_DECISIONS]?: ReadonlyMap<string, ScopeAuthorizationDecision>;
}

export function getScopeAuthorizationDecision(request: unknown, scope: string): ScopeAuthorizationDecision | undefined {
  if (!request || typeof request !== 'object') return undefined;
  return (request as ScopeAuthorizedRequest)[REQUEST_SCOPE_DECISIONS]?.get(scope);
}

export function isScopeAuthorizationDecision(value: unknown, scope: string): value is ScopeAuthorizationDecision {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ScopeAuthorizationDecision>;
  return (
    candidate.scope === scope && candidate.granted === true && candidate[SCOPE_AUTHORIZATION_DECISION_BRAND] === true
  );
}

function recordScopeAuthorizationDecisions(request: ScopeAuthorizedRequest, scopes: string[]): void {
  const decisions = new Map(request[REQUEST_SCOPE_DECISIONS] ?? []);
  for (const scope of scopes) {
    decisions.set(
      scope,
      Object.freeze({
        scope,
        granted: true as const,
        [SCOPE_AUTHORIZATION_DECISION_BRAND]: true as const,
      }),
    );
  }
  request[REQUEST_SCOPE_DECISIONS] = decisions;
}

@Injectable()
export class ScopeGuard implements CanActivate {
  private readonly logger = new Logger(ScopeGuard.name);

  constructor(
    private reflector: Reflector,
    @Inject(AuthorizationService) private authService: Pick<AuthorizationService, 'getScopesByRoles'>,
    /** 새 권한 판정으로 넘어간 서비스의 권한 라우트에서는 물러난다(판정 낙인도 남기지 않는다). */
    @Optional() @Inject(PermissionAuthority) private readonly authority?: Pick<PermissionAuthority, 'decides'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.authority?.decides(context)) return true;
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ScopeAuthorizedRequest>();
    const grantedScopes = await this.getGrantedScopes(request.user, requiredScopes);
    if (grantedScopes.length > 0) recordScopeAuthorizationDecisions(request, grantedScopes);
    return grantedScopes.length > 0;
  }

  /** Shared by route enforcement and permission previews; lookup failure always denies. */
  async getGrantedScopes(user: { roles?: string[] } | undefined, requiredScopes: string[]): Promise<string[]> {
    if (!user?.roles) return [];
    if (user.roles.includes('master')) return requiredScopes;
    try {
      const userScopes = await this.authService.getScopesByRoles(user.roles);
      return userScopes.has('master') ? requiredScopes : requiredScopes.filter((scope) => userScopes.has(scope));
    } catch (error) {
      this.logger.error('Failed to fetch role-scope mappings from DB', error);
      return [];
    }
  }
}
