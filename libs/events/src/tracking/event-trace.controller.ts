import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
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
