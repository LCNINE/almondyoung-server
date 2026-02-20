import { DbService } from '@app/db';
import { StreamPublisher } from '@app/events';
import { PaymentsEventsV1 } from '@packages/event-contracts/streams/payments-v1.stream';
import { WalletSchema } from '../schema';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

describe('OutboxDispatcherService', () => {
  const originalOutboxMaxAttempts = process.env.WALLET_OUTBOX_MAX_ATTEMPTS;
  const originalDeadLetterEnabled = process.env.WALLET_OUTBOX_DEAD_LETTER_ENABLED;

  afterEach(() => {
    if (originalOutboxMaxAttempts === undefined) {
      delete process.env.WALLET_OUTBOX_MAX_ATTEMPTS;
    } else {
      process.env.WALLET_OUTBOX_MAX_ATTEMPTS = originalOutboxMaxAttempts;
    }

    if (originalDeadLetterEnabled === undefined) {
      delete process.env.WALLET_OUTBOX_DEAD_LETTER_ENABLED;
    } else {
      process.env.WALLET_OUTBOX_DEAD_LETTER_ENABLED = originalDeadLetterEnabled;
    }
  });

  it('uses persisted outbox messageId when building envelope', () => {
    const dbService = { db: {} } as unknown as DbService<WalletSchema>;
    const publisher = {
      publishRawEnvelope: jest.fn(),
    } as unknown as StreamPublisher<PaymentsEventsV1>;

    const service = new OutboxDispatcherService(dbService, publisher);
    const envelope = (
      service as unknown as {
        buildEnvelope: (row: unknown) => { messageId: string };
      }
    ).buildEnvelope({
        id: 'outbox-1',
        messageId: 'msg-fixed-1',
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: 'intent-1',
        partitionKey: 'intent-1',
        payload: {
          occurredAt: '2026-02-01T00:00:00.000Z',
        },
        attempts: 0,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      });

    expect(envelope.messageId).toBe('msg-fixed-1');
  });

  it('accepts valid payments event payload against schema contract', () => {
    const service = new OutboxDispatcherService(
      { db: {} } as unknown as DbService<WalletSchema>,
      {
        publishRawEnvelope: jest.fn(),
      } as unknown as StreamPublisher<PaymentsEventsV1>,
    );

    expect(() =>
      (
        service as unknown as {
          validatePayloadContract: (row: unknown) => void;
        }
      ).validatePayloadContract({
        id: 'outbox-1',
        messageId: 'msg-1',
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: 'intent-1',
        partitionKey: 'intent-1',
        payload: {
          intentId: 'intent-1',
          referenceType: 'STORE_ORDER',
          referenceId: 'order-1',
          userId: 'customer-1',
          status: 'SUCCEEDED',
          payableAmount: 1000,
          currency: 'KRW',
          occurredAt: '2026-02-01T00:00:00.000Z',
        },
        attempts: 0,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ).not.toThrow();
  });

  it('rejects invalid payments event payload against schema contract', () => {
    const service = new OutboxDispatcherService(
      { db: {} } as unknown as DbService<WalletSchema>,
      {
        publishRawEnvelope: jest.fn(),
      } as unknown as StreamPublisher<PaymentsEventsV1>,
    );

    expect(() =>
      (
        service as unknown as {
          validatePayloadContract: (row: unknown) => void;
        }
      ).validatePayloadContract({
        id: 'outbox-1',
        messageId: 'msg-1',
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: 'intent-1',
        partitionKey: 'intent-1',
        payload: {
          intentId: 'intent-1',
          referenceType: 'STORE_ORDER',
          userId: 'customer-1',
          status: 'SUCCEEDED',
          payableAmount: 1000,
          currency: 'KRW',
          occurredAt: '2026-02-01T00:00:00.000Z',
        },
        attempts: 0,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ).toThrow(/OUTBOX_PAYLOAD_CONTRACT_INVALID/);
  });

  it('marks terminal publish failure as DEAD_LETTER by default', async () => {
    process.env.WALLET_OUTBOX_MAX_ATTEMPTS = '1';
    delete process.env.WALLET_OUTBOX_DEAD_LETTER_ENABLED;

    const { service, setMock } = createServiceWithUpdateMock();

    await (
      service as unknown as {
        markFailure: (event: unknown, error: unknown) => Promise<void>;
      }
    ).markFailure(createOutboxRow(), new Error('publisher unavailable'));

    expect(setMock).toHaveBeenCalledTimes(1);
    const updatePayload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe('DEAD_LETTER');
    expect(updatePayload.attempts).toBe(1);
    expect(updatePayload.nextAttemptAt).toBeNull();
    expect(updatePayload.lastErrorCode).toBe('OUTBOX_PUBLISH_FAILED');
    expect(updatePayload.deadLetteredAt).toBeInstanceOf(Date);
    expect(updatePayload.deadLetterReason).toBe(
      '[OUTBOX_PUBLISH_FAILED] publisher unavailable',
    );
  });

  it('falls back to FAILED terminal status when dead-letter flag is disabled', async () => {
    process.env.WALLET_OUTBOX_MAX_ATTEMPTS = '1';
    process.env.WALLET_OUTBOX_DEAD_LETTER_ENABLED = 'false';

    const { service, setMock } = createServiceWithUpdateMock();

    await (
      service as unknown as {
        markFailure: (event: unknown, error: unknown) => Promise<void>;
      }
    ).markFailure(createOutboxRow(), new Error('publisher unavailable'));

    expect(setMock).toHaveBeenCalledTimes(1);
    const updatePayload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe('FAILED');
    expect(updatePayload.deadLetteredAt).toBeNull();
    expect(updatePayload.deadLetterReason).toBeNull();
  });

  it('clears dead-letter metadata when publish succeeds after manual requeue', async () => {
    const { service, setMock, publisher } = createServiceWithUpdateMock();

    await (
      service as unknown as {
        processEvent: (event: unknown) => Promise<void>;
      }
    ).processEvent(
      createOutboxRow({
        attempts: 3,
      }),
    );

    expect(publisher.publishRawEnvelope).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
    const updatePayload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe('PUBLISHED');
    expect(updatePayload.nextAttemptAt).toBeNull();
    expect(updatePayload.lastErrorCode).toBeNull();
    expect(updatePayload.lastErrorMessage).toBeNull();
    expect(updatePayload.deadLetteredAt).toBeNull();
    expect(updatePayload.deadLetterReason).toBeNull();
  });
});

function createServiceWithUpdateMock() {
  const whereMock = jest.fn().mockResolvedValue(undefined);
  const setMock = jest.fn().mockReturnValue({
    where: whereMock,
  });
  const updateMock = jest.fn().mockReturnValue({
    set: setMock,
  });
  const dbService = {
    db: {
      update: updateMock,
    },
  } as unknown as DbService<WalletSchema>;
  const publisher = {
    publishRawEnvelope: jest.fn().mockResolvedValue(undefined),
  } as unknown as StreamPublisher<PaymentsEventsV1>;
  const service = new OutboxDispatcherService(dbService, publisher);

  return {
    service,
    updateMock,
    setMock,
    whereMock,
    publisher,
  };
}

function createOutboxRow(
  override?: Partial<{
    id: string;
    messageId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    partitionKey: string;
    payload: Record<string, unknown>;
    attempts: number;
    createdAt: Date;
  }>,
) {
  return {
    id: override?.id ?? 'outbox-1',
    messageId: override?.messageId ?? 'msg-fixed-1',
    eventType: override?.eventType ?? 'PaymentIntentSucceeded',
    aggregateType: override?.aggregateType ?? 'PaymentIntent',
    aggregateId: override?.aggregateId ?? 'intent-1',
    partitionKey: override?.partitionKey ?? 'intent-1',
    payload: override?.payload ?? {
      intentId: 'intent-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      userId: 'customer-1',
      status: 'SUCCEEDED',
      payableAmount: 1000,
      currency: 'KRW',
      occurredAt: '2026-02-01T00:00:00.000Z',
    },
    attempts: override?.attempts ?? 0,
    createdAt: override?.createdAt ?? new Date('2026-02-01T00:00:00.000Z'),
  };
}
