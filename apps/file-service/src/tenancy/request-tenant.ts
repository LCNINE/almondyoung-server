import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 요청의 테넌트 id. `null` = 테넌트를 모르는 요청 — 전환 배포 ①(warn)에서만 여기 온다. ②(reject)는 문이 이미 거절했다.
 * 파일이 사는 테넌트(`uploads.tenant_id`)도 같은 꼴이다: `null` 이면 테넌트 전 버킷(env)에 산다.
 */
export type RequestTenantId = string | null;

export const REQUEST_TENANT_KEY = 'fileServiceTenant';

/**
 * 문(`FileRequestTenantInterceptor`)이 정한 테넌트. 문이 돌지 않은 라우트에서 부르면 던진다 — 테넌트를 모르는 채로
 * 조용히 «테넌트 없음»(①)으로 흐르지 않게.
 */
export const RequestTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestTenantId => {
  const request = ctx.switchToHttp().getRequest<{ [REQUEST_TENANT_KEY]?: RequestTenantId }>();
  const tenant = request[REQUEST_TENANT_KEY];
  if (tenant === undefined) throw new Error('file-service: 요청 테넌트 문이 돌지 않은 라우트다');
  return tenant;
});

/**
 * 파일이 요청의 테넌트 것인가. 요청 테넌트를 모르면(①) 판정할 수 없으니 지금처럼 연다 — ① 에는 테넌트 1 뿐이다.
 * 행의 테넌트가 비었으면(백필 뒤엔 없다) 다른 테넌트로 본다.
 */
export function fileBelongsTo(file: { tenantId: string | null }, tenant: RequestTenantId): boolean {
  return tenant === null || file.tenantId === tenant;
}
