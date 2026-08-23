import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventTraceQueryService, TraceResourceListResponse, TraceResponse } from '@app/events';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';

/**
 * 이벤트 추적 조회 (admin-web 이벤트 추적 화면).
 *
 * 이 앱의 전역 `WalletAuthGuard` 는 표시가 없으면 마지막 분기에서 `WALLET_API_KEY` bearer 를
 * 요구한다. 어드민 브라우저는 쿠키를 보내므로 표시가 없으면 **401 로 화면이 죽는다**. 또 전역
 * 가드라 컨트롤러 `@UseGuards` 보다 먼저 도므로 가드를 얹는 방식으로는 우회가 안 된다 —
 * 이 앱이 관리자 경로로 인정하는 유일한 길이 `@WalletAdminAuth()` 메타데이터다 (#705).
 */
@WalletAdminAuth()
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
