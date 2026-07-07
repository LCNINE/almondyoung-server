import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 서버 간(internal) 호출 전용 API key 가드.
 *
 * `Authorization: Bearer ${MEMBERSHIP_INTERNAL_KEY}` 를 요구한다.
 * 키가 미설정이면 전부 거부(fail-closed) — 무인증으로 열리는 것보다 호출자가 즉시 실패를 보는 쪽이 안전하다.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('MEMBERSHIP_INTERNAL_KEY');
    if (!expected) {
      throw new UnauthorizedException('MEMBERSHIP_INTERNAL_KEY is not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const authHeader = request.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    return true;
  }
}
