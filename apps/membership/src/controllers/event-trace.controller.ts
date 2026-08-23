import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventTraceQueryService, TraceResourceListResponse, TraceResponse } from '@app/events';
import { MembershipAdminAuth } from '../shared/decorators/admin-auth.decorator';

/**
 * 이벤트 추적 조회 (admin-web 이벤트 추적 화면).
 *
 * 이 앱의 전역 가드는 `JwtAuthGuard` + `ScopeGuard` 인데, `ScopeGuard` 는 `@RequireScopes` 가
 * **없으면 통과**시킨다. 즉 표시를 안 붙이면 "로그인한 고객이면 누구나"가 된다. 그래서 이 앱의
 * 관리자 관용구인 `@MembershipAdminAuth()` 를 명시한다 (#705).
 */
@MembershipAdminAuth()
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
