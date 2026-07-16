import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator';
import { AuthorizationService } from '../services/authorization.service';

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
    private authService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ScopeAuthorizedRequest>();
    const user = request.user;

    if (!user || !user.roles) {
      return false;
    }

    if (user.roles.includes('master')) {
      recordScopeAuthorizationDecisions(request, requiredScopes);
      return true;
    }

    try {
      const userScopes = await this.authService.getScopesByRoles(user.roles);

      if (userScopes.has('master')) {
        recordScopeAuthorizationDecisions(request, requiredScopes);
        return true;
      }

      const grantedScopes = requiredScopes.filter((scope) => userScopes.has(scope));
      if (grantedScopes.length > 0) recordScopeAuthorizationDecisions(request, grantedScopes);
      return grantedScopes.length > 0;
    } catch (error) {
      this.logger.error('Failed to fetch role-scope mappings from DB', error);
      return false;
    }
  }
}
