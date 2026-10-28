import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventTraceQueryService, TraceResourceListResponse, TraceResponse } from '@app/events';
import { RequirePermission } from '@app/authorization';

/**
 * 이벤트 추적 조회 (admin-web 이벤트 추적 화면).
 *
 * 판정은 전역 `PermissionGuard` 가 `system.operations.read` 로 한다.
 *
 * 옛날엔 이 컨트롤러가 `libs/events` 에 있으면서 `@SetMetadata('isPublic', true)` 를 달고
 * 있었고, 그게 5개 앱 전부에서 인터넷 무인증 노출이 됐다 (#705).
 */
@Controller('events/trace')
export class EventTraceController {
  constructor(private readonly traceQuery: EventTraceQueryService) {}

  /** GET /events/trace/resource/:resourceType?limit=20&offset=0 */
  @RequirePermission('system.operations.read')
  @Get('resource/:resourceType')
  async getResourcesByType(
    @Param('resourceType') resourceType: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<TraceResourceListResponse> {
    return this.traceQuery.listResourcesByType(resourceType, limit, offset);
  }

  /** GET /events/trace/resource/:resourceType/:resourceId */
  @RequirePermission('system.operations.read')
  @Get('resource/:resourceType/:resourceId')
  async getByResource(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
  ): Promise<TraceResponse> {
    return this.traceQuery.byResource(resourceType, resourceId);
  }

  /** GET /events/trace/chain/:chainId */
  @RequirePermission('system.operations.read')
  @Get('chain/:chainId')
  async getByChain(@Param('chainId') chainId: string): Promise<TraceResponse> {
    return this.traceQuery.byChain(chainId);
  }
}
