import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * auth-web 서버 전용 경로의 가드 — `x-internal-secret: ${OAUTH_INTERNAL_SECRET}` 를 요구한다(`/oauth/internal/*` 와 같은 비밀).
 * 비밀이 미설정이면 전부 거부(fail-closed).
 */
@Injectable()
export class OAuthInternalSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('OAUTH_INTERNAL_SECRET');
    if (!expected) throw new UnauthorizedException('OAUTH_INTERNAL_SECRET is not configured');

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    if (request.headers['x-internal-secret'] !== expected) {
      throw new UnauthorizedException('invalid internal secret');
    }
    return true;
  }
}
