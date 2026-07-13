import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { v7 } from 'uuid';
import { DbService } from '@app/db';
import { event_resource_links, trackingSchema } from './tracking.schema';
import { EventChainService } from './event-chain.service';

export const EVENT_TRACKING_SERVICE_NAME = 'EVENT_TRACKING_SERVICE_NAME';

type DbTx = Parameters<Parameters<PostgresJsDatabase<typeof trackingSchema>['transaction']>[0]>[0];

@Injectable()
export class EventTrackingService {
  private readonly logger = new Logger(EventTrackingService.name);

  constructor(
    // ponytail: @Optional — search 등 Postgres DbService 없는 컨슈머 앱에서 EventsModule DI가
    // 깨지지 않도록. DB 없으면 트래킹은 no-op (아래 guard).
    @Optional()
    private readonly dbService: DbService | undefined,
    private readonly eventChainService: EventChainService,
    @Optional()
    @Inject(EVENT_TRACKING_SERVICE_NAME)
    private readonly serviceName: string,
  ) {}

  /**
   * 어떤 리소스가 이벤트 발행을 유발했는지 기록 (CAUSE)
   */
  async trackCause(
    params: {
      eventId: string;
      chainId: string;
      eventType: string;
      resourceType: string;
      resourceId: string;
      description?: string;
    },
    tx?: DbTx,
  ): Promise<void> {
    const db = (tx ?? this.dbService?.db) as any;
    if (!db) return; // DbService 없는 앱(search)에선 트래킹 skip
    await db.insert(event_resource_links).values({
      id: v7(),
      eventId: params.eventId,
      chainId: params.chainId,
      eventType: params.eventType,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      direction: 'CAUSE',
      description: params.description,
      serviceName: this.serviceName,
    });
  }

  /**
   * 이벤트 처리 결과로 리소스에 어떤 작업이 일어났는지 기록 (EFFECT)
   *
   * chainId, eventId는 CLS에서 자동 추출
   */
  async trackEffect(
    params: {
      resourceType: string;
      resourceId: string;
      action: string;
      description?: string;
      eventType?: string;
    },
    tx?: DbTx,
  ): Promise<void> {
    const chainId = this.eventChainService.getChainId();
    const eventId = this.eventChainService.getEventId();

    if (!chainId || !eventId) {
      this.logger.warn('trackEffect called without CLS chain context - skipping', {
        resourceType: params.resourceType,
        resourceId: params.resourceId,
      });
      return;
    }

    const db = (tx ?? this.dbService?.db) as any;
    if (!db) return; // DbService 없는 앱(search)에선 트래킹 skip
    await db.insert(event_resource_links).values({
      id: v7(),
      eventId,
      chainId,
      eventType: params.eventType ?? 'unknown',
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      direction: 'EFFECT',
      action: params.action,
      description: params.description,
      serviceName: this.serviceName,
    });
  }
}
