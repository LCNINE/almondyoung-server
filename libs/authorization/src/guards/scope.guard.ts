import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator';
import { AuthorizationService } from '../services/authorization.service';

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

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.roles) {
      return false;
    }

    if (user.roles.includes('master')) {
      return true;
    }

    try {
      const userScopes = await this.authService.getScopesByRoles(user.roles);

      if (userScopes.has('master')) {
        return true;
      }

      return requiredScopes.some((scope) => userScopes.has(scope));
    } catch (error) {
      this.logger.error('Failed to fetch role-scope mappings from DB', error);
      return false;
    }
  }
}
