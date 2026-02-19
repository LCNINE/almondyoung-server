import {
  CreatePaymentIntentCommandPayload,
} from '@packages/event-contracts';
import { DomainCommand } from '@packages/event-contracts/types';
import { IdempotencyService } from '../domain/idempotency/idempotency.service';
import { IntentsService } from '../intents/intents.service';
import { ReconcileService } from '../reconcile/reconcile.service';
import { PaymentsCommandConsumer } from './payments-command.consumer';

describe('PaymentsCommandConsumer', () => {
  let consumer: PaymentsCommandConsumer;
  let intentsService: jest.Mocked<IntentsService>;
  let reconcileService: jest.Mocked<ReconcileService>;
  let idempotencyService: jest.Mocked<IdempotencyService>;

  beforeEach(() => {
    intentsService = {
      createIntent: jest.fn(),
      authorizeLeg: jest.fn(),
      captureLeg: jest.fn(),
      cancelIntent: jest.fn(),
      expireIntent: jest.fn(),
      supersedeIntent: jest.fn(),
      createRefundRequest: jest.fn(),
    } as unknown as jest.Mocked<IntentsService>;

    reconcileService = {
      retryLeg: jest.fn(),
      retryIntent: jest.fn(),
    } as unknown as jest.Mocked<ReconcileService>;

    idempotencyService = {
      beginCommandRequest: jest.fn(),
      completeSuccess: jest.fn(),
      completeFailure: jest.fn(),
    } as unknown as jest.Mocked<IdempotencyService>;

    consumer = new PaymentsCommandConsumer(
      intentsService,
      reconcileService,
      idempotencyService,
    );
  });

  it('processes command once when idempotency is STARTED', async () => {
    idempotencyService.beginCommandRequest.mockResolvedValue({
      kind: 'STARTED',
      recordId: 'record-1',
    });

    await consumer.onCreatePaymentIntent(createPaymentIntentCommand());

    expect(idempotencyService.beginCommandRequest).toHaveBeenCalledWith({
      idempotencyKey: 'cmd-idem-1',
      operation: 'CreatePaymentIntent',
      requestBody: expect.objectContaining({
        idempotencyKey: 'cmd-idem-1',
      }),
    });
    expect(intentsService.createIntent).toHaveBeenCalledTimes(1);
    expect(idempotencyService.completeSuccess).toHaveBeenCalledWith(
      'record-1',
      200,
      { commandType: 'CreatePaymentIntent', status: 'PROCESSED' },
    );
  });

  it('skips duplicate command when idempotency decision is REPLAY', async () => {
    idempotencyService.beginCommandRequest.mockResolvedValue({
      kind: 'REPLAY',
      responseCode: 200,
      responseBody: { status: 'PROCESSED' },
    });

    await consumer.onCreatePaymentIntent(createPaymentIntentCommand());

    expect(intentsService.createIntent).not.toHaveBeenCalled();
    expect(idempotencyService.completeSuccess).not.toHaveBeenCalled();
    expect(idempotencyService.completeFailure).not.toHaveBeenCalled();
  });

  it('records failure snapshot and rethrows command processing error', async () => {
    idempotencyService.beginCommandRequest.mockResolvedValue({
      kind: 'STARTED',
      recordId: 'record-2',
    });
    intentsService.createIntent.mockRejectedValue(new Error('boom'));

    await expect(
      consumer.onCreatePaymentIntent(createPaymentIntentCommand()),
    ).rejects.toThrow('boom');

    expect(idempotencyService.completeFailure).toHaveBeenCalledWith(
      'record-2',
      500,
      {
        error: 'COMMAND_PROCESS_FAILED',
        message: 'boom',
      },
    );
  });
});

function createPaymentIntentCommand(): DomainCommand<CreatePaymentIntentCommandPayload> {
  return {
    messageId: 'msg-1',
    messageType: 'CreatePaymentIntent',
    messageVersion: 1,
    messageKind: 'command',
    correlationId: 'corr-1',
    timestamp: new Date().toISOString(),
    source: {
      service: 'checkout',
      aggregateType: 'Order',
      aggregateId: 'order-1',
    },
    payload: {
      requestedBy: 'service-checkout',
      requestSource: 'checkout',
      idempotencyKey: 'cmd-idem-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      customerId: 'customer-1',
      currency: 'KRW',
      payableAmount: 1000,
      snapshotPayload: {
        orderId: 'order-1',
      },
      signature: 'sig',
      signatureVersion: 'v1',
      signedAt: new Date().toISOString(),
    },
  };
}
