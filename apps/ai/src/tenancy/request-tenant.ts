import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 요청의 테넌트 id. `null` = 테넌트를 모르는 요청 — 전환 배포 ①(warn)에서만 여기 온다. ②(reject)는 문이 이미 거절했다.
 * `null` 이면 지금처럼 다룬다: 쓰기는 테넌트를 싣지 않고(DB 기본값), 읽기는 테넌트로 거르지 않는다. ① 에는 테넌트 1 뿐이다.
 */
export type RequestTenantId = string | null;

export const REQUEST_TENANT_KEY = 'aiTenant';

/**
 * 문(`AiRequestTenantInterceptor`)이 정한 테넌트. 문이 돌지 않은 라우트에서 부르면 던진다 — 테넌트를 모르는 채로
 * 조용히 «테넌트 없음»(①)으로 흐르지 않게.
 */
export const RequestTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestTenantId => {
  const request = ctx.switchToHttp().getRequest<{ [REQUEST_TENANT_KEY]?: RequestTenantId }>();
  const tenant = request[REQUEST_TENANT_KEY];
  if (tenant === undefined) throw new Error('ai: 요청 테넌트 문이 돌지 않은 라우트다');
  return tenant;
});
