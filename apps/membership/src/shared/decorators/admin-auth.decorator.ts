import { applyDecorators, UseGuards } from '@nestjs/common';
import { RolesGuard } from '@app/authorization';

/**
 * 관리자(admin/master) 전용 라우트 인가 데코레이터.
 *
 * 인증(JWT)은 전역 `JwtAuthGuard`(APP_GUARD)가 이미 담당하므로, 여기서는 인가만 한다.
 * wallet 의 `@WalletAdminAuth()` 와 동일하게 `admin` 또는 `master` 역할을 요구한다.
 */
export const MembershipAdminAuth = () => applyDecorators(UseGuards(RolesGuard('admin', 'master')));
