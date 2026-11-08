import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 요청의 테넌트 id — 문(`AiRequestTenantInterceptor`)이 토큰·테넌트 헤더로 정한다. 모르면 문이 거절하므로 여기엔 늘 있다.
 * 대화·업로드 추적 행의 테넌트(NOT NULL)도 이 값이다.
 */
export type RequestTenantId = string;

export const REQUEST_TENANT_KEY = 'aiTenant';

/** 문이 정한 테넌트. 문이 돌지 않은 라우트에서 부르면 던진다 — 테넌트를 모르는 채로 흐르지 않게. */
export const RequestTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestTenantId => {
  const request = ctx.switchToHttp().getRequest<{ [REQUEST_TENANT_KEY]?: RequestTenantId }>();
  const tenant = request[REQUEST_TENANT_KEY];
  if (tenant === undefined) throw new Error('ai: 요청 테넌트 문이 돌지 않은 라우트다');
  return tenant;
});
