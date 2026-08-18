import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './public.decorator';
import { InternalKeyGuard } from '../guards/internal-key.guard';

/**
 * 사람 JWT 가 아니라 **공유 내부 키**로 보호되는 서비스 간 라우트임을 표시한다.
 *
 * 전역 `JwtAuthGuard`/`AdminRealmGuard` 를 면제(`IS_PUBLIC_KEY`)하되, 같은 라우트에
 * `InternalKeyGuard` 를 바인딩해 키를 강제한다. **둘을 손으로 따로 붙이지 말 것** — 하나만
 * 붙으면 각각 무인증 개방이거나 내부 호출자 401 이 된다. 한 데코레이터로 묶어두면 그 실수가
 * 구조적으로 불가능해진다.
 *
 * 쓰는 쪽 모듈이 `INTERNAL_KEY_ENV` 토큰으로 읽을 env 이름을 제공해야 한다.
 */
export const InternalOnly = () => applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), UseGuards(InternalKeyGuard));
