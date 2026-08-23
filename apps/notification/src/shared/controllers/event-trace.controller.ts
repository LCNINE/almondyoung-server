import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventTraceQueryService, TraceResourceListResponse, TraceResponse } from '@app/events';

/**
 * 이벤트 추적 조회 (admin-web 이벤트 추적 화면).
 *
 * 인가 데코레이터가 없는 게 의도다 — 이 앱은 전역 `AdminRealmGuard` 가 표시 없는 라우트를
 * 직원(admin/master) 전용으로 **기본 차단**한다. 표시를 붙이면 오히려 그 기본값에서 빠져나간다.
 *
 * 옛날엔 이 컨트롤러가 `libs/events` 에 있으면서 `@SetMetadata('isPublic', true)` 를 달고
 * 있었고, 그게 5개 앱 전부에서 인터넷 무인증 노출이 됐다 (#705).
 */
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
