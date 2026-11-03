import { timingSafeEqual } from 'node:crypto';
import { tenantHeaderOf } from '@app/tenancy';

type RequestHeaders = Record<string, string | string[] | undefined> | undefined;

/**
 * auth-web 서버가 «이 요청은 그 테넌트 화면에서 왔다»고 보증했는가 — `x-internal-secret` 이 `OAUTH_INTERNAL_SECRET` 과 같다.
 * 브라우저는 이 비밀을 모른다. 비밀이 설정되지 않은 서버는 아무것도 믿지 않는다.
 */
export function isVouchedByAuthWeb(headers: RequestHeaders, internalSecret: string | undefined): boolean {
  const given = headers?.['x-internal-secret'];
  if (!internalSecret || typeof given !== 'string') return false;
  const candidate = Buffer.from(given);
  const expected = Buffer.from(internalSecret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** 보증된 화면 테넌트(`x-tenant-id`). 보증이 없으면 헤더를 무시한다 — 헤더 하나로 남의 테넌트 화면인 척하지 못하게. */
export function vouchedSiteTenant(headers: RequestHeaders, internalSecret: string | undefined): string | undefined {
  return isVouchedByAuthWeb(headers, internalSecret) ? tenantHeaderOf({ headers }) : undefined;
}
