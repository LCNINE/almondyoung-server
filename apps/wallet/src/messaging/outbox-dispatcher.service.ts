import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import {
  InjectStreamPublisher,
  StreamPublisher,
} from '@app/events';
import {
  PAYMENTS_EVENTS_V1_STREAM,
  PaymentsEventsV1,
} from '@packages/event-contracts/streams/payments-v1.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { WalletSchema, outboxEvents } from '../schema';

const DEFAULT_OUTBOX_DISPATCH_CRON = '*/5 * * * * *';
const DEFAULT_OUTBOX_BATCH_SIZE = 100;
const DEFAULT_OUTBOX_MAX_ATTEMPTS = 10;
const DEFAULT_OUTBOX_BASE_DELAY_MS = 5_000;
const DEFAULT_OUTBOX_MAX_DELAY_MS = 300_000;
const DEFAULT_OUTBOX_PROCESSING_TIMEOUT_SECONDS = 300;

type PaymentsEventType = keyof PaymentsEventsV1 & string;

const SUPPORTED_PAYMENT_EVENT_TYPES = new Set<PaymentsEventType>(
  Object.keys(PAYMENTS_EVENTS_V1_STREAM.events) as PaymentsEventType[],
);

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly processingTimeoutSeconds: number;

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    @InjectStreamPublisher(PAYMENTS_EVENTS_V1_STREAM.topic.topic)
    private readonly paymentsPublisher: StreamPublisher<PaymentsEventsV1>,
  ) {
    this.batchSize = this.readPositiveInt(
      process.env.WALLET_OUTBOX_BATCH_SIZE,
      DEFAULT_OUTBOX_BATCH_SIZE,
    );
    this.maxAttempts = this.readPositiveInt(
      process.env.WALLET_OUTBOX_MAX_ATTEMPTS,
      DEFAULT_OUTBOX_MAX_ATTEMPTS,
    );
    this.baseDelayMs = this.readPositiveInt(
      process.env.WALLET_OUTBOX_BASE_DELAY_MS,
      DEFAULT_OUTBOX_BASE_DELAY_MS,
    );
    this.maxDelayMs = this.readPositiveInt(
      process.env.WALLET_OUTBOX_MAX_DELAY_MS,
      DEFAULT_OUTBOX_MAX_DELAY_MS,
    );
    this.processingTimeoutSeconds = this.readPositiveInt(
      process.env.WALLET_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
      DEFAULT_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
    );
  }

  @Cron(process.env.WALLET_OUTBOX_DISPATCH_CRON ?? DEFAULT_OUTBOX_DISPATCH_CRON)
  async dispatchPendingEvents(): Promise<void> {
    await this.requeueStuckProcessingEvents();
    const batch = await this.acquirePendingBatch();

    if (batch.length === 0) {
      return;
    }

    for (const event of batch) {
      await this.processEvent(event);
    }
  }

  private async acquirePendingBatch(): Promise<OutboxRow[]> {
    return this.dbService.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select
          current.id as "id",
          current.message_id as "messageId",
          current.event_type as "eventType",
          current.aggregate_type as "aggregateType",
          current.aggregate_id as "aggregateId",
          current.partition_key as "partitionKey",
          current.payload as "payload",
          current.attempts as "attempts",
          current.created_at as "createdAt"
        from outbox_events current
        where current.status = 'PENDING'
          and (
            current.next_attempt_at is null
            or current.next_attempt_at <= now()
          )
          and not exists (
            select 1
            from outbox_events previous
            where previous.partition_key = current.partition_key
              and (
                previous.created_at < current.created_at
                or (previous.created_at = current.created_at and previous.id < current.id)
              )
              and previous.status <> 'PUBLISHED'
          )
        order by current.created_at asc, current.id asc
        limit ${this.batchSize}
        for update skip locked
      `)) as unknown as OutboxRow[];

      if (rows.length === 0) {
        return [];
      }

      const ids = rows.map((row) => row.id);
      await tx
        .update(outboxEvents)
        .set({
          status: 'PROCESSING',
          updatedAt: new Date(),
        })
        .where(inArray(outboxEvents.id, ids));

      return rows;
    });
  }

  private async processEvent(event: OutboxRow): Promise<void> {
    try {
      if (!this.isSupportedEventType(event.eventType)) {
        throw new Error(`OUTBOX_EVENT_TYPE_UNSUPPORTED:${event.eventType}`);
      }
      this.validatePayloadContract({
        ...event,
        eventType: event.eventType,
      });

      const envelope = this.buildEnvelope(event);
      await this.paymentsPublisher.publishRawEnvelope(envelope, event.partitionKey);

      await this.dbService.db
        .update(outboxEvents)
        .set({
          status: 'PUBLISHED',
          publishedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(outboxEvents.id, event.id));

      this.logger.debug(
        `Outbox publish succeeded: id=${event.id}, messageId=${event.messageId}, eventType=${event.eventType}, partitionKey=${event.partitionKey}`,
      );
    } catch (error) {
      await this.markFailure(event, error);
    }
  }

  private async markFailure(event: OutboxRow, error: unknown): Promise<void> {
    const nextAttempts = event.attempts + 1;
    const shouldFail = nextAttempts >= this.maxAttempts;
    const nextAttemptAt = shouldFail
      ? null
      : new Date(Date.now() + this.calculateBackoffMs(nextAttempts));
    const { errorCode, errorMessage } = this.toOutboxError(error);

    await this.dbService.db
      .update(outboxEvents)
      .set({
        status: shouldFail ? 'FAILED' : 'PENDING',
        attempts: nextAttempts,
        nextAttemptAt,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(outboxEvents.id, event.id));

    this.logger.warn(
      `Outbox publish failed: id=${event.id}, messageId=${event.messageId}, attempts=${nextAttempts}, final=${shouldFail}, eventType=${event.eventType}, partitionKey=${event.partitionKey}, reason=${errorMessage}`,
    );
  }

  private async requeueStuckProcessingEvents(): Promise<void> {
    const threshold = new Date(Date.now() - this.processingTimeoutSeconds * 1000);
    const rows = await this.dbService.db
      .update(outboxEvents)
      .set({
        status: 'PENDING',
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
        lastErrorCode: 'OUTBOX_PROCESSING_TIMEOUT',
        lastErrorMessage: `Requeued after ${this.processingTimeoutSeconds}s timeout`,
      })
      .where(
        and(
          eq(outboxEvents.status, 'PROCESSING'),
          lte(outboxEvents.updatedAt, threshold),
        ),
      )
      .returning({ id: outboxEvents.id });

    if (rows.length > 0) {
      this.logger.warn(`Requeued ${rows.length} stuck outbox events`);
    }
  }

  private buildEnvelope(event: OutboxRow): DomainEvent<Record<string, unknown>> {
    const nowIso = new Date().toISOString();
    const occurredAt = this.readPayloadTimestamp(event.payload, nowIso);
    const correlationId = this.readPayloadString(
      event.payload,
      'correlationId',
      `${event.aggregateId}:${event.id}`,
    ) ?? `${event.aggregateId}:${event.id}`;
    const causationId = this.readPayloadString(event.payload, 'causationId');

    return {
      messageId: event.messageId,
      messageType: event.eventType,
      messageVersion: 1,
      messageKind: 'event',
      correlationId,
      causationId,
      timestamp: nowIso,
      occurredAt,
      source: {
        service: process.env.SERVICE_NAME ?? 'wallet',
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
      },
      payload: event.payload,
      metadata: {
        outboxEventId: event.id,
      },
    };
  }

  private validatePayloadContract(
    event: OutboxRow & {
      eventType: PaymentsEventType;
    },
  ): void {
    const eventDef = PAYMENTS_EVENTS_V1_STREAM.events[event.eventType];
    const schema = eventDef?.schema;
    if (!schema) {
      return;
    }

    const parsed = schema.safeParse(event.payload);
    if (parsed.success) {
      return;
    }

    const firstIssue = parsed.error.issues[0];
    const issuePath = firstIssue?.path?.join('.') || 'payload';
    const issueMessage = firstIssue?.message || 'unknown schema validation error';
    throw new Error(
      `OUTBOX_PAYLOAD_CONTRACT_INVALID:${event.eventType}:${issuePath}:${issueMessage}`,
    );
  }

  private readPayloadTimestamp(
    payload: Record<string, unknown>,
    fallback: string,
  ): string {
    const raw = payload.occurredAt;
    if (typeof raw !== 'string') {
      return fallback;
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return new Date(parsed).toISOString();
  }

  private readPayloadString(
    payload: Record<string, unknown>,
    key: string,
    fallback?: string,
  ): string | undefined {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return fallback;
  }

  private calculateBackoffMs(attempt: number): number {
    const exponential = this.baseDelayMs * Math.max(1, 2 ** (attempt - 1));
    return Math.min(exponential, this.maxDelayMs);
  }

  private toOutboxError(error: unknown): {
    errorCode: string;
    errorMessage: string;
  } {
    if (error instanceof Error) {
      const [maybeCode] = error.message.split(':');
      const errorCode = maybeCode.startsWith('OUTBOX_')
        ? maybeCode
        : 'OUTBOX_PUBLISH_FAILED';
      return {
        errorCode,
        errorMessage: error.message,
      };
    }
    return {
      errorCode: 'OUTBOX_PUBLISH_FAILED',
      errorMessage: String(error),
    };
  }

  private readPositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private isSupportedEventType(eventType: string): eventType is PaymentsEventType {
    return SUPPORTED_PAYMENT_EVENT_TYPES.has(eventType as PaymentsEventType);
  }
}

interface OutboxRow {
  id: string;
  messageId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  partitionKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date | string;
}
