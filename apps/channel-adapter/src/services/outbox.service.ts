import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { channelAdapterSchema, outboxEvents } from '../schema';
import { ChannelAdapterSchema } from '../types';

// DbTx 타입 정의 (WMS 패턴 참고)
type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

/**
 * OutboxService
 *
 * 책임:
 * - 이벤트를 Outbox 테이블에 enqueue
 * - 트랜잭션 내에서 호출되어 원자성 보장
 */
@Injectable()
export class OutboxService {
  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  /**
   * 이벤트를 Outbox에 enqueue
   *
   * @param params - 이벤트 정보
   * @param tx - 트랜잭션 컨텍스트 (선택적)
   *
   * @example
   * await this.outboxService.enqueue({
   *   eventType: 'OrderSyncCompleted',
   *   aggregateId: 'naver-ORD-123',
   *   partitionKey: 'naver_smartstore',
   *   payload: { ... },
   *   metadata: { correlationId: '...' },
   * }, tx);
   */
  async enqueue(
    params: {
      eventType: string;
      aggregateId: string;
      partitionKey: string;
      payload: unknown;
      metadata?: Record<string, unknown>;
      aggregateType?: string; // 'ChannelAdapter' (기본값) 또는 'Order'
    },
    tx?: DbTx,
  ): Promise<void> {
    const exec = async (trx: DbTx) => {
      await trx.insert(outboxEvents).values({
        eventType: params.eventType,
        aggregateType: 'ChannelAdapter',
        aggregateId: params.aggregateId,
        partitionKey: params.partitionKey,
        payload: params.payload as any,
        metadata: params.metadata as any,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      });
    };

    if (tx) {
      return exec(tx);
    }
    return this.db.db.transaction(exec);
  }
}
