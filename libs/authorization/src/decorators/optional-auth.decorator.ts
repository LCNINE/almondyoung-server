import { applyDecorators, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '../guards/optional-auth.guard';

/**
 * Optional Authentication Decorator
 * 인증이 선택적인 라우트에 사용
 * - 토큰이 있으면 파싱하여 @User() 데코레이터로 userId 사용 가능
 * - 토큰이 없거나 유효하지 않아도 요청 통과
 */
export const OptionalAuth = () => applyDecorators(UseGuards(OptionalAuthGuard));
