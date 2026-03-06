import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { WalletSchema, outboxEvents } from '../schema';

const DEFAULT_OUTBOX_DISPATCH_CRON = '*/5 * * * * *';
const DEFAULT_OUTBOX_BATCH_SIZE = 100;
const DEFAULT_OUTBOX_MAX_ATTEMPTS = 10;
const DEFAULT_OUTBOX_BASE_DELAY_MS = 5_000;
const DEFAULT_OUTBOX_MAX_DELAY_MS = 300_000;
const DEFAULT_OUTBOX_PROCESSING_TIMEOUT_SECONDS = 300;
const DEFAULT_OUTBOX_DEAD_LETTER_ENABLED = true;

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

@Injectable()
export class OutboxDispatcherService {
  private static readonly MEDUSA_EVENT_TYPES = new Set([
    'payment.intent.succeeded',
    'payment.intent.captured',
    'payment.intent.canceled',
    'payment.intent.failed',
  ]);

  private readonly logger = new Logger(OutboxDispatcherService.name);
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly processingTimeoutSeconds: number;
  private readonly deadLetterEnabled: boolean;
  private readonly medusaWebhookUrl: string | undefined;

  constructor(private readonly dbService: DbService<WalletSchema>) {
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
    this.deadLetterEnabled = this.readBoolean(
      process.env.WALLET_OUTBOX_DEAD_LETTER_ENABLED,
      DEFAULT_OUTBOX_DEAD_LETTER_ENABLED,
    );
    this.medusaWebhookUrl = process.env.WALLET_MEDUSA_WEBHOOK_URL?.trim() || undefined;
  }

  @Cron(process.env.WALLET_OUTBOX_DISPATCH_CRON ?? DEFAULT_OUTBOX_DISPATCH_CRON)
  async dispatchPendingEvents(): Promise<void> {
    try {
      await this.requeueStuckProcessingEvents();
      const batch = await this.acquirePendingBatch();

      if (batch.length === 0) return;

      for (const event of batch) {
        await this.processEvent(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Outbox dispatch batch failed: ${message}`);
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
              and previous.status in ('PENDING', 'PROCESSING')
          )
        order by current.created_at asc, current.id asc
        limit ${this.batchSize}
        for update skip locked
      `)) as unknown as OutboxRow[];

      if (rows.length === 0) return [];

      const ids = rows.map((row) => row.id);
      await tx
        .update(outboxEvents)
        .set({ status: 'PROCESSING', updatedAt: new Date() })
        .where(inArray(outboxEvents.id, ids));

      return rows;
    });
  }

  private async processEvent(event: OutboxRow): Promise<void> {
    try {
      const shouldDispatch =
        this.medusaWebhookUrl &&
        OutboxDispatcherService.MEDUSA_EVENT_TYPES.has(event.eventType);

      if (shouldDispatch) {
        await this.dispatchToMedusa(event);
      } else {
        this.logger.debug(
          `Outbox event log-only: id=${event.id}, eventType=${event.eventType}, aggregateId=${event.aggregateId}`,
        );
      }

      await this.dbService.db
        .update(outboxEvents)
        .set({
          status: 'PUBLISHED',
          publishedAt: new Date(),
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          deadLetteredAt: null,
          deadLetterReason: null,
          updatedAt: new Date(),
        })
        .where(eq(outboxEvents.id, event.id));
    } catch (error) {
      await this.markFailure(event, error);
    }
  }

  private async dispatchToMedusa(event: OutboxRow): Promise<void> {
    const body = JSON.stringify({ ...event.payload, type: event.eventType });

    const res = await fetch(this.medusaWebhookUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `OUTBOX_MEDUSA_HTTP_ERROR: POST ${this.medusaWebhookUrl} returned ${res.status}: ${text}`,
      );
    }

    this.logger.debug(
      `Outbox dispatched to Medusa: id=${event.id}, eventType=${event.eventType}, status=${res.status}`,
    );
  }

  private async markFailure(event: OutboxRow, error: unknown): Promise<void> {
    const nextAttempts = event.attempts + 1;
    const isTerminalFailure = nextAttempts >= this.maxAttempts;
    const isDeadLetter = isTerminalFailure && this.deadLetterEnabled;
    const nextStatus = isDeadLetter
      ? 'DEAD_LETTER'
      : isTerminalFailure
        ? 'FAILED'
        : 'PENDING';
    const nextAttemptAt = isTerminalFailure
      ? null
      : new Date(Date.now() + this.calculateBackoffMs(nextAttempts));
    const { errorCode, errorMessage } = this.toOutboxError(error);

    await this.dbService.db
      .update(outboxEvents)
      .set({
        status: nextStatus,
        attempts: nextAttempts,
        nextAttemptAt,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        deadLetteredAt: isDeadLetter ? new Date() : null,
        deadLetterReason: isDeadLetter ? `[${errorCode}] ${errorMessage}` : null,
        updatedAt: new Date(),
      })
      .where(eq(outboxEvents.id, event.id));

    this.logger.warn(
      `Outbox publish failed: id=${event.id}, messageId=${event.messageId}, attempts=${nextAttempts}, terminal=${isTerminalFailure}, eventType=${event.eventType}`,
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
        deadLetteredAt: null,
        deadLetterReason: null,
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

  private calculateBackoffMs(attempt: number): number {
    const exponential = this.baseDelayMs * Math.max(1, 2 ** (attempt - 1));
    return Math.min(exponential, this.maxDelayMs);
  }

  private toOutboxError(error: unknown): { errorCode: string; errorMessage: string } {
    if (error instanceof Error) {
      const [maybeCode] = error.message.split(':');
      const errorCode = maybeCode.startsWith('OUTBOX_')
        ? maybeCode
        : 'OUTBOX_PUBLISH_FAILED';
      return { errorCode, errorMessage: error.message };
    }
    return { errorCode: 'OUTBOX_PUBLISH_FAILED', errorMessage: String(error) };
  }

  private readPositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  private readBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
  }
}
