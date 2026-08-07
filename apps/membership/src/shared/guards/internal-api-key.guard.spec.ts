import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalApiKeyGuard } from './internal-api-key.guard';

/**
 * 가드는 있었지만 테스트가 없었다. `benefit-tracking.controller` 의 `internal/*` 두 건이
 * 이 가드를 안 달고 `@Public()` 만 붙어 있던 걸 2026-08 인가 감사에서 잡았다(P0-2).
 * 동작을 못으로 박아둔다.
 */
describe('InternalApiKeyGuard', () => {
  const guardWith = (configured: string | undefined) =>
    new InternalApiKeyGuard({ get: () => configured } as unknown as ConfigService);

  const ctx = (authorization?: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
    }) as unknown as ExecutionContext;

  it('키가 일치하면 통과시킨다', () => {
    expect(guardWith('secret').canActivate(ctx('Bearer secret'))).toBe(true);
  });

  it('Authorization 헤더가 없으면 거부한다', () => {
    expect(() => guardWith('secret').canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('토큰이 다르면 거부한다', () => {
    expect(() => guardWith('secret').canActivate(ctx('Bearer wrong'))).toThrow(UnauthorizedException);
  });

  it('Bearer 스킴이 아니면 거부한다', () => {
    expect(() => guardWith('secret').canActivate(ctx('secret'))).toThrow(UnauthorizedException);
  });

  it('키가 설정돼 있지 않으면 올바른 토큰이 와도 거부한다(fail-closed)', () => {
    expect(() => guardWith(undefined).canActivate(ctx('Bearer secret'))).toThrow(UnauthorizedException);
  });
});
