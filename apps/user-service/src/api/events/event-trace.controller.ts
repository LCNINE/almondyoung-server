import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EventTraceQueryService, TraceResourceListResponse, TraceResponse } from '@app/events';
import { RolesGuard } from '@app/authorization';

/**
 * 이벤트 추적 조회 (admin-web 이벤트 추적 화면).
 *
 * 이 앱의 전역 가드는 `JwtAuthGuard` + `ScopeGuard` 인데, `ScopeGuard` 는 `@RequireScopes` 가
 * **없으면 통과**시킨다. 즉 표시를 안 붙이면 "로그인한 고객이면 누구나"가 된다 (#705).
 *
 * 왜 이 앱의 관용구인 `@RequireScopes('master')` 가 아닌가 — admin-web 은 쿠키 하나로 6개
 * 서비스에 **동시 fan-out** 한다. 여기만 master 를 요구하면 admin 사용자에게 user-service 칸만
 * rejected 로 뜬다. 나머지 4개 앱이 모두 admin/master 를 통과시키므로 같은 폭으로 맞춘다.
 */
@UseGuards(RolesGuard('admin', 'master'))
@Controller('events/trace')
export class EventTraceController {
  constructor(private readonly traceQuery: EventTraceQueryService) {}

  /** GET /events/trace/resource/:resourceType?limit=20&offset=0 */
  @Get('resource/:resourceType')
  async getResourcesByType(
    @Param('resourceType') resourceType: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<TraceResourceListResponse> {
    return this.traceQuery.listResourcesByType(resourceType, limit, offset);
  }

  /** GET /events/trace/resource/:resourceType/:resourceId */
  @Get('resource/:resourceType/:resourceId')
  async getByResource(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
  ): Promise<TraceResponse> {
    return this.traceQuery.byResource(resourceType, resourceId);
  }

  /** GET /events/trace/chain/:chainId */
  @Get('chain/:chainId')
  async getByChain(@Param('chainId') chainId: string): Promise<TraceResponse> {
    return this.traceQuery.byChain(chainId);
  }
}
