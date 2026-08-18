import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalKeyGuard } from './internal-key.guard';

// 키 미설정 경로는 의도적으로 error 로그를 남긴다 — 스펙 출력까지 더럽힐 이유는 없다.
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  jest.restoreAllMocks();
});

const ENV_VAR = 'CORE_INTERNAL_KEY';
const CONFIGURED_KEY = 's3cret-internal-key';

/** ConfigService 를 실제로 세우면 전역 env 에 의존한다 — 조회 한 건만 흉내낸다. */
function configWith(value: string | undefined): ConfigService {
  return { get: (name: string) => (name === ENV_VAR ? value : undefined) } as unknown as ConfigService;
}

function contextFor(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  } as unknown as ExecutionContext;
}

describe('InternalKeyGuard', () => {
  describe('키가 설정돼 있을 때', () => {
    const guard = () => new InternalKeyGuard(configWith(CONFIGURED_KEY), ENV_VAR);

    it('Bearer 접두사와 함께 올바른 키를 보내면 통과한다', () => {
      expect(guard().canActivate(contextFor(`Bearer ${CONFIGURED_KEY}`))).toBe(true);
    });

    it('접두사 없이 raw 키만 보내도 통과한다 — 기존 verifyInternalKey 관용구와 호환', () => {
      expect(guard().canActivate(contextFor(CONFIGURED_KEY))).toBe(true);
    });

    it('키가 틀리면 거부한다', () => {
      expect(() => guard().canActivate(contextFor('Bearer wrong-key'))).toThrow(UnauthorizedException);
    });

    it('Authorization 헤더가 없으면 거부한다', () => {
      expect(() => guard().canActivate(contextFor())).toThrow(UnauthorizedException);
    });

    it('길이가 다른 값이 와도 예외 없이 거부한다 — timingSafeEqual 은 길이가 다르면 throw 한다', () => {
      expect(() => guard().canActivate(contextFor('Bearer short'))).toThrow(UnauthorizedException);
    });
  });

  describe('서버에 키가 설정돼 있지 않을 때', () => {
    // 설정 누락이 곧 무인증 개방이 되면 안 된다 — 배포 순서 사고의 최악 형태다.
    it('빈 값을 보내도 거부한다', () => {
      const guard = new InternalKeyGuard(configWith(undefined), ENV_VAR);
      expect(() => guard.canActivate(contextFor('Bearer '))).toThrow(UnauthorizedException);
    });

    it('헤더를 아예 안 보내도 거부한다', () => {
      const guard = new InternalKeyGuard(configWith(undefined), ENV_VAR);
      expect(() => guard.canActivate(contextFor())).toThrow(UnauthorizedException);
    });
  });
});
