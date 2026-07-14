import { Injectable, Optional } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, inArray, and, countDistinct } from 'drizzle-orm';
import { event_resource_links } from './tracking.schema';

export interface TraceLink {
  id: string;
  eventId: string;
  chainId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  direction: string;
  action: string | null;
  description: string | null;
  serviceName: string | null;
  createdAt: Date;
}

@Injectable()
export class EventTraceReader {
  // ponytail: @Optional — search 등 DbService 없는 앱에서 EventsModule DI가 깨지지 않도록.
  // 트레이스 조회 API가 없는(=DB 없는) 앱에선 이 reader가 호출될 일이 없다.
  constructor(@Optional() private readonly dbService: DbService | undefined) {}

  private get db() {
    if (!this.dbService) {
      throw new Error('EventTraceReader: DbService unavailable (no DB in this app)');
    }
    return this.dbService.db as any;
  }

  /**
   * 리소스(resourceType + resourceId)에 연관된 모든 이벤트 링크 조회
   *
   * 1) 해당 리소스가 포함된 모든 chain_id 수집
   * 2) 수집된 chain_id에 속하는 모든 링크 반환
   */
  async findByResource(resourceType: string, resourceId: string): Promise<TraceLink[]> {
    const chainRows = await this.db
      .selectDistinct({ chainId: event_resource_links.chainId })
      .from(event_resource_links)
      .where(and(eq(event_resource_links.resourceType, resourceType), eq(event_resource_links.resourceId, resourceId)));

    if (chainRows.length === 0) {
      return [];
    }

    const chainIds: string[] = chainRows.map((r: { chainId: string }) => r.chainId);
    return this.findByChainIds(chainIds);
  }

  /**
   * chainId에 속하는 모든 이벤트 링크 조회
   */
  async findByChain(chainId: string): Promise<TraceLink[]> {
    return this.findByChainIds([chainId]);
  }

  /**
   * 특정 resourceType에 속하는 고유 resourceId 목록을 페이지네이션해서 조회
   */
  async findResourcesByType(resourceType: string, limit: number, offset: number): Promise<{ resourceId: string }[]> {
    const rows = await this.db
      .selectDistinct({ resourceId: event_resource_links.resourceId })
      .from(event_resource_links)
      .where(eq(event_resource_links.resourceType, resourceType))
      .orderBy(event_resource_links.resourceId)
      .limit(limit)
      .offset(offset);

    return rows;
  }

  async countResourcesByType(resourceType: string): Promise<number> {
    const [row] = await this.db
      .select({ count: countDistinct(event_resource_links.resourceId) })
      .from(event_resource_links)
      .where(eq(event_resource_links.resourceType, resourceType));
    return row?.count ?? 0;
  }

  private async findByChainIds(chainIds: string[]): Promise<TraceLink[]> {
    return this.db
      .select()
      .from(event_resource_links)
      .where(inArray(event_resource_links.chainId, chainIds))
      .orderBy(event_resource_links.createdAt);
  }
}
