import { ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';

/**
 * JWT Authentication Guard
 * Protects routes requiring authentication
 * Skips authentication for routes marked with @Public() or @OptionalAuth()
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || isOptionalAuth) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const cookieToken = request?.cookies?.accessToken;

    this.logger.debug(`Authorization Header: ${authHeader}`);
    this.logger.debug(`Cookie accessToken: ${cookieToken ? 'present' : 'missing'}`);
    this.logger.debug(`All cookies: ${JSON.stringify(request.cookies || {})}`);

    return super.canActivate(context);
  }
  handleRequest(err: any, user: any, info: any) {
    console.log('🛡️ [JwtAuthGuard] handleRequest:', {
      hasError: !!err,
      hasUser: !!user,
      info: info?.message || info,
      errorMessage: err?.message,
    });

    if (err || !user) {
      console.error('❌ [JwtAuthGuard] Authentication failed:', {
        error: err?.message || err,
        info: info?.message || info,
      });
      throw err || new UnauthorizedException('Unauthorized access');
    }
    return user;
  }
}
