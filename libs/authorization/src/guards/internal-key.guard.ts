import { CanActivate, ExecutionContext, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * `InternalKeyGuard` 가 읽을 env 변수 **이름**을 담는 DI 토큰.
 *
 * 서비스마다 자기 키 이름이 다르므로(core 는 `CORE_INTERNAL_KEY`) 가드에 이름을 박지 않고
 * 마운트하는 모듈이 정한다.
 */
export const INTERNAL_KEY_ENV = 'INTERNAL_KEY_ENV';

/**
 * 사람 JWT 가 없는 **서비스 간 호출** 전용 가드. 공유 시크릿을 `Authorization` 헤더로 받는다.
 *
 * 단독으로 쓰지 말고 `@InternalOnly()` 를 쓸 것 — 전역 `JwtAuthGuard`/`AdminRealmGuard` 면제와
 * 이 가드의 바인딩이 **한 벌로** 붙어야 한다. 둘 중 하나만 붙으면 각각 "내부 호출자가 401" 이거나
 * "무인증 개방" 이 된다.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalKeyGuard.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(INTERNAL_KEY_ENV) private readonly envVarName: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>(this.envVarName);

    // 설정 누락은 개방이 아니라 폐쇄다. 키 없이 뜬 서비스가 내부 라우트를 열어두면
    // 배포 순서 사고 한 번이 무인증 노출이 된다.
    if (!expected) {
      this.logger.error(`${this.envVarName} 가 설정되지 않았다 — 내부 라우트를 전부 거부한다.`);
      throw new UnauthorizedException('Internal key not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | undefined> }>();
    const presented = request.headers?.authorization?.replace(/^Bearer\s+/i, '').trim() ?? '';

    if (!this.matches(presented, expected)) {
      throw new UnauthorizedException('Invalid internal key');
    }

    return true;
  }

  private matches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    // timingSafeEqual 은 길이가 다르면 던진다. 길이 비교를 먼저 해서 예외 대신 거부로 만든다.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
