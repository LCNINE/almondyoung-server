import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { outbox_events } from './outbox.schema';
import { SaveEventParams, DbTx } from './outbox.types';
import { generateMessageId } from '../utils/message-id.util';

@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  async saveEvent(params: SaveEventParams, tx: DbTx): Promise<void> {
    const messageId = generateMessageId();
    const now = new Date();

    // MessageEnvelope 구조로 payload 구성
    const envelope = {
      messageId,
      messageType: params.eventType,
      messageVersion: 1,
      messageKind: 'event' as const,
      correlationId: params.correlationId || messageId,
      causationId: params.causationId,
      timestamp: now.toISOString(),
      occurredAt: now.toISOString(),
      source: {
        service: 'unknown', // OutboxDispatcher에서 발행 시 설정됨
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
      },
      payload: params.payload,
      metadata: params.metadata,
    };

    await tx.insert(outbox_events).values({
      topic: params.topic,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      payload: envelope,
      status: 'PENDING',
    });

    this.logger.debug(`Outbox event saved: ${params.eventType}`, {
      topic: params.topic,
      aggregateId: params.aggregateId,
    });
  }
}
