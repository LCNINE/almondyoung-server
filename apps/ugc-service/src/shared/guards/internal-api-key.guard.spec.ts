import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UgcInternalApiKeyGuard } from './internal-api-key.guard';

/**
 * 이 가드가 지키는 것: `POST /reviews/eligibilities` 는 바디의 `userId` 를 그대로 믿고 리뷰
 * 작성 자격을 발급한다. 자격 → 리뷰 → `EarnPointsRequested` → wallet 포인트 적립까지 이어지므로
 * 무인증이면 임의 사용자에게 포인트를 발행할 수 있다 (2026-08 API 인가 감사 P0-1).
 */
describe('UgcInternalApiKeyGuard', () => {
  const guardWith = (configured: string | undefined) =>
    new UgcInternalApiKeyGuard({ get: () => configured } as unknown as ConfigService);

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

  it('Bearer 스킴이 아니면 거부한다 — 키를 그대로 넣는 실수를 통과시키지 않는다', () => {
    expect(() => guardWith('secret').canActivate(ctx('secret'))).toThrow(UnauthorizedException);
  });

  // fail-closed. 키를 안 심고 배포하면 조용히 무인증으로 열리는 대신 호출자가 즉시 실패를 본다.
  it('키가 설정돼 있지 않으면 올바른 토큰이 와도 거부한다', () => {
    expect(() => guardWith(undefined).canActivate(ctx('Bearer secret'))).toThrow(UnauthorizedException);
  });
});
