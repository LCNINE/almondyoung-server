import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventTraceReader, TraceLink } from './event-trace.reader';

export interface TraceResponse {
  links: TraceLink[];
  chainIds: string[];
  total: number;
}

@Controller('events/trace')
export class EventTraceController {
  constructor(private readonly eventTraceReader: EventTraceReader) {}

  /**
   * resourceType에 속하는 리소스 목록 페이지네이션 조회
   *
   * GET /events/trace/resource/:resourceType?limit=20&offset=0
   */
  @Get('resource/:resourceType')
  async getResourcesByType(
    @Param('resourceType') resourceType: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<{ resources: { resourceId: string }[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(parseInt(limitStr ?? '20', 10) || 20, 100);
    const offset = parseInt(offsetStr ?? '0', 10) || 0;

    const [resources, total] = await Promise.all([
      this.eventTraceReader.findResourcesByType(resourceType, limit, offset),
      this.eventTraceReader.countResourcesByType(resourceType),
    ]);

    return { resources, total, limit, offset };
  }

  /**
   * 리소스에 연관된 모든 이벤트 링크 조회
   *
   * GET /events/trace/resource/:resourceType/:resourceId
   */
  @Get('resource/:resourceType/:resourceId')
  async getByResource(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
  ): Promise<TraceResponse> {
    const links = await this.eventTraceReader.findByResource(resourceType, resourceId);
    const chainIds = [...new Set(links.map((l) => l.chainId))];
    return { links, chainIds, total: links.length };
  }

  /**
   * chain에 속하는 모든 이벤트 링크 조회
   *
   * GET /events/trace/chain/:chainId
   */
  @Get('chain/:chainId')
  async getByChain(@Param('chainId') chainId: string): Promise<TraceResponse> {
    const links = await this.eventTraceReader.findByChain(chainId);
    return { links, chainIds: chainId ? [chainId] : [], total: links.length };
  }
}
