import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { WalletExecutor } from '../../shared/database';

/**
 * OutboxService
 * 
 * 책임: 이벤트를 Outbox 테이블에 저장
 * - 비즈니스 트랜잭션과 동일한 트랜잭션에서 이벤트 저장
 * - OutboxDispatcher가 폴링하여 Kafka로 발행
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * 이벤트를 Outbox에 추가 (큐잉)
   * 
   * @param params 이벤트 정보
   * @param tx 트랜잭션 (필수 - 비즈니스 로직과 동일 트랜잭션 사용)
   */
  async enqueue(
    params: {
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      partitionKey: string;
      payload: Record<string, any>;
      metadata?: Record<string, any>;
    },
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx ?? this.db.db;

    await executor.insert(schema.outboxEvents).values({
      eventType: params.eventType,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      partitionKey: params.partitionKey,
      payload: params.payload,
      metadata: params.metadata,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
    });

    this.logger.debug(
      `Outbox 이벤트 저장: ${params.eventType} (${params.aggregateId})`,
    );
  }

  /**
   * 여러 이벤트를 한 번에 Outbox에 추가
   * 
   * @param events 이벤트 배열
   * @param tx 트랜잭션
   */
  async enqueueBatch(
    events: Array<{
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      partitionKey: string;
      payload: Record<string, any>;
      metadata?: Record<string, any>;
    }>,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (events.length === 0) return;

    const executor = tx ?? this.db.db;

    await executor.insert(schema.outboxEvents).values(
      events.map((event) => ({
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        partitionKey: event.partitionKey,
        payload: event.payload,
        metadata: event.metadata,
        status: 'PENDING' as const,
        attempts: 0,
        nextAttemptAt: new Date(),
      })),
    );

    this.logger.debug(`Outbox 이벤트 배치 저장: ${events.length}개`);
  }
}

