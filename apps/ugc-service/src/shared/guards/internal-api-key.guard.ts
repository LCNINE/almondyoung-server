import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 서버 간(internal) 호출 전용 API key 가드.
 *
 * `Authorization: Bearer ${UGC_INTERNAL_KEY}` 를 요구한다.
 * 키가 미설정이면 전부 거부(fail-closed) — 무인증으로 열리는 것보다 호출자가 즉시 실패를 보는 쪽이 안전하다.
 *
 * membership 의 같은 이름 가드와 형태가 같다. 공용 lib 로 묶지 않은 건 의도다 — 앱마다 키 env 와
 * 신뢰 경계가 다르고, 한 곳을 고치다 다른 앱의 인증을 조용히 바꾸는 게 이 계열 사고의 원인이었다.
 */
@Injectable()
export class UgcInternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('UGC_INTERNAL_KEY');
    if (!expected) {
      throw new UnauthorizedException('UGC_INTERNAL_KEY is not configured');
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
