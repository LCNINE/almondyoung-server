import { GUARDS_METADATA } from '@nestjs/common/constants';
import { InternalOnly } from './internal-only.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { InternalKeyGuard } from '../guards/internal-key.guard';

class Routes {
  @InternalOnly()
  internalRoute(): void {}

  bare(): void {}
}

describe('@InternalOnly()', () => {
  // 이 둘은 한 벌이어야 한다. 하나만 붙으면 각각 다른 사고가 된다:
  // 공개 표시만 → 무인증 개방 / 가드만 → 전역 JwtAuthGuard 가 내부 호출자를 401 로 막는다.
  it('전역 인증 가드를 면제하는 공개 표시를 남긴다', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Routes.prototype.internalRoute)).toBe(true);
  });

  it('같은 라우트에 InternalKeyGuard 를 바인딩한다', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, Routes.prototype.internalRoute) as unknown[];
    expect(guards).toContain(InternalKeyGuard);
  });

  it('데코레이터가 없는 라우트는 둘 다 남기지 않는다', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Routes.prototype.bare)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, Routes.prototype.bare)).toBeUndefined();
  });
});
