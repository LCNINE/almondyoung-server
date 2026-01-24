import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { channelAdapterSchema, inboxEvents } from '../schema';
import { ChannelAdapterSchema } from '../types';

// DbTx 타입 정의 (WMS 패턴 참고)
type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

/**
 * InboxService
 *
 * ⚠️ 주의: Inbox 패턴 (이벤트 수신 처리)
 * - Kafka에서 받은 이벤트를 Inbox 테이블에 저장
 * - Consumer는 빠르게 ACK, Worker가 비동기 처리
 * - 공용 Outbox (libs/events)와는 다른 용도
 *
 * 책임:
 * - 수신한 이벤트를 Inbox 테이블에 저장
 * - 트랜잭션 내에서 호출되어 원자성 보장
 */
@Injectable()
export class InboxService {
  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  /**
   * 수신한 이벤트를 Inbox에 저장
   *
   * @param params - 이벤트 정보
   * @param tx - 트랜잭션 컨텍스트 (선택적)
   *
   * @example
   * await this.inboxService.enqueue({
   *   eventType: 'ProductMasterActiveVersionChanged',
   *   aggregateId: 'pim-master-123',
   *   partitionKey: 'pim-master-123',
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
      aggregateType?: string; // 'Product', 'Order' 등
    },
    tx?: DbTx,
  ): Promise<void> {
    const exec = async (trx: DbTx) => {
      await trx.insert(inboxEvents).values({
        eventType: params.eventType,
        aggregateType: params.aggregateType || 'ChannelAdapter',
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
