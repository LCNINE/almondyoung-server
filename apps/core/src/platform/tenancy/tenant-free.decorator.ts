import { SetMetadata } from '@nestjs/common';

export const TENANT_FREE_KEY = 'core:tenant_free';

/**
 * core DB 에 닿지 않는 라우트 — 요청 문이 테넌트를 정하지 않는다(ALB 헬스체크처럼 토큰도 헤더도 없이 부른다).
 * 이 라우트가 DB 에 닿게 되면 ② 에서 `TenantContextMissingError` 로 실패한다(빠뜨려도 새지 않고 터진다).
 */
export const TenantFree = () => SetMetadata(TENANT_FREE_KEY, true);
