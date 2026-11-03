import { ForbiddenException } from '@nestjs/common';
import { tenantHeaderOf, type TenantList } from '@app/tenancy';

/**
 * 내부 키(`USER_SERVICE_INTERNAL_KEY`) 호출의 테넌트 — 호출자가 실은 `x-tenant-id`. 키는 여러 테넌트를 섬기는 호출자도 쥐므로
 * 테넌트를 말하지 못한다. 전화번호·발송 대상으로 계정을 찾는 내부 라우트는 이 테넌트의 계정만 본다(ADR-0056).
 *
 * 없거나 목록 밖이면 거절한다 — 기본 테넌트는 없다. 호출자(`UserContactClient`)는 `OutboundTenant` 로 늘 싣는다.
 */
export function internalCallTenant(request: unknown, tenants: TenantList): string {
  const tenant = tenantHeaderOf(request);
  if (tenant === undefined) throw new ForbiddenException('테넌트 헤더(x-tenant-id)가 없는 내부 호출입니다.');
  if (!tenants.find(tenant)) throw new ForbiddenException('테넌트 목록에 없는 테넌트입니다.');
  return tenant;
}
