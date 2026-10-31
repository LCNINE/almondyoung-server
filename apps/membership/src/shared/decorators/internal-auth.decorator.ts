import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public, ServiceKeyRoute } from '@app/authorization';
import { InternalApiKeyGuard } from '../guards/internal-api-key.guard';

/**
 * 서버 간(internal) 라우트 인증 데코레이터.
 *
 * 전역 `JwtAuthGuard` 를 `@Public()` 으로 우회하는 대신 `InternalApiKeyGuard` 가
 * `Authorization: Bearer ${MEMBERSHIP_INTERNAL_KEY}` 를 강제한다. 서비스 키 입구라 테넌트 헤더도 필수다(`ServiceKeyRoute`).
 */
export const MembershipInternalAuth = () =>
  applyDecorators(Public(), ServiceKeyRoute(), UseGuards(InternalApiKeyGuard));
