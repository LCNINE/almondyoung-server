import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 서버 간(internal) 호출 전용 API key 가드.
 *
 * `Authorization: Bearer ${USER_SERVICE_INTERNAL_KEY}` 를 요구한다.
 * 키가 미설정이면 전부 거부(fail-closed) — user-service 는 공개 ALB 뒤에 있어서,
 * 무인증으로 열리면 userId 만 알면 이메일이 나오는 열거 창구가 된다.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('USER_SERVICE_INTERNAL_KEY');
    if (!expected) {
      throw new UnauthorizedException('USER_SERVICE_INTERNAL_KEY is not configured');
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
