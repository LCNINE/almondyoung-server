import { DbService } from '@app/db';
import { StreamPublisher } from '@app/events';
import { PaymentsEventsV1 } from '@packages/event-contracts/streams/payments-v1.stream';
import { WalletSchema } from '../schema';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

describe('OutboxDispatcherService', () => {
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
          customerId: 'customer-1',
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
          customerId: 'customer-1',
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
});
