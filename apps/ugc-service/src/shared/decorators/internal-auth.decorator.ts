import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from '@app/authorization';
import { UgcInternalApiKeyGuard } from '../guards/internal-api-key.guard';

/**
 * 서버 간(internal) 라우트 인증 데코레이터.
 *
 * 전역 `JwtAuthGuard` 를 `@Public()` 으로 우회하는 대신 `UgcInternalApiKeyGuard` 가
 * `Authorization: Bearer ${UGC_INTERNAL_KEY}` 를 강제한다.
 *
 * `@Public()` 을 단독으로 쓰면 인증이 통째로 사라진다 — 내부 라우트에는 항상 이 데코레이터를 쓴다.
 */
export const UgcInternalAuth = () => applyDecorators(Public(), UseGuards(UgcInternalApiKeyGuard));
