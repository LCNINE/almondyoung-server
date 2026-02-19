import { DbService } from '@app/db';
import { StreamPublisher } from '@app/events';
import { PaymentsEventsV1 } from '@packages/event-contracts';
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
      });

    expect(envelope.messageId).toBe('msg-fixed-1');
  });
});
