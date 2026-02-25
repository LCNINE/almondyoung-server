import { generateMessageId } from '@app/events';
import { outboxEvents } from '../schema';

export interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  partitionKey?: string;
  payload: Record<string, unknown>;
}

export function buildOutboxInsertValues(
  event: OutboxEventInput,
): typeof outboxEvents.$inferInsert {
  assertOutboxEventInput(event);

  const now = new Date();
  const messageId = generateMessageId();
  if (!messageId.trim()) {
    throw new Error('OUTBOX_MESSAGE_ID_MISSING');
  }

  return {
    messageId,
    eventType: event.eventType.trim(),
    aggregateType: event.aggregateType.trim(),
    aggregateId: event.aggregateId.trim(),
    partitionKey: event.partitionKey?.trim() || event.aggregateId.trim(),
    payload: event.payload,
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function assertOutboxEventInput(event: OutboxEventInput): void {
  assertNonEmptyString('eventType', event.eventType);
  assertNonEmptyString('aggregateType', event.aggregateType);
  assertNonEmptyString('aggregateId', event.aggregateId);

  if (event.partitionKey !== undefined) {
    assertNonEmptyString('partitionKey', event.partitionKey);
  }

  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('OUTBOX_PAYLOAD_INVALID: payload must be a JSON object');
  }
}

function assertNonEmptyString(field: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`OUTBOX_EVENT_FIELD_INVALID: ${field} must be a non-empty string`);
  }
}
