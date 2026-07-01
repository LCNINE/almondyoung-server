import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { AdminIdempotencyInterceptor } from './admin-idempotency.interceptor';

export const ADMIN_IDEMPOTENT_OP = 'admin_idempotent_op';

/**
 * 관리자 운영 액션에 Idempotency-Key 기반 멱등성을 부여한다.
 * @param operation 멱등 키의 네임스페이스 (operation+key 유니크). 예: 'force-cancel'
 */
export const IdempotentAdminOp = (operation: string) =>
  applyDecorators(SetMetadata(ADMIN_IDEMPOTENT_OP, operation), UseInterceptors(AdminIdempotencyInterceptor));
