import { and, desc, eq } from 'drizzle-orm';
import {
  manualCancelQueueItems,
  outboxEvents,
  paymentIntents,
  paymentLegs,
} from '../schema';
import {
  WalletIntegrationContext,
  cleanupPhase2TestData,
  closeWalletIntegrationContext,
  createSignedCreateIntentBody,
  createWalletIntegrationContext,
  describeWalletDbIntegration,
  phase2ScopedValue,
  sendWriteRequest,
} from './test-helpers/wallet-test-app';

jest.setTimeout(180_000);

describeWalletDbIntegration('Intents phase3 compensation integration (real path)', () => {
  let context: WalletIntegrationContext;

  beforeAll(async () => {
    context = await createWalletIntegrationContext();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanupPhase2TestData(context.dbService);
    await closeWalletIntegrationContext(context);
  });

  it('runs cancel compensation before refund compensation', async () => {
    const intentId = await createPendingIntent(context, 'phase3-compensation-order');
    const legs = await configureTwoLegs(context, intentId);
    const firstLeg = legs.find((leg) => leg.sequenceNo === 1);
    const secondLeg = legs.find((leg) => leg.sequenceNo === 2);

    expect(firstLeg).toBeDefined();
    expect(secondLeg).toBeDefined();

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${firstLeg!.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-order-authorize-1'),
    }).expect(201);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${firstLeg!.id}/capture`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-order-capture-1'),
    }).expect(201);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${secondLeg!.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-order-authorize-2'),
    }).expect(201);

    const cancelSpy = jest.spyOn(context.pointsProvider, 'cancel');
    const refundSpy = jest.spyOn(context.pointsProvider, 'refund');

    const cancelIntent = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/cancel`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-order-cancel-intent'),
    }).expect(201);

    expect(cancelIntent.body.data.status).toBe('CANCELLED');
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy.mock.invocationCallOrder[0]).toBeLessThan(
      refundSpy.mock.invocationCallOrder[0],
    );

    const legRows = await context.dbService.db
      .select({
        id: paymentLegs.id,
        sequenceNo: paymentLegs.sequenceNo,
        status: paymentLegs.status,
      })
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intentId));

    const capturedLeg = legRows.find((leg) => leg.sequenceNo === 1);
    const authorizedLeg = legRows.find((leg) => leg.sequenceNo === 2);

    expect(capturedLeg?.status).toBe('REFUNDED');
    expect(authorizedLeg?.status).toBe('CANCELLED');
  });

  it('enqueues manual cancel queue and emits reconcile-required event when cancel compensation fails', async () => {
    const intentId = await createPendingIntent(context, 'phase3-compensation-cancel-fail');
    const [leg] = await configureSingleLeg(context, intentId, 10000);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-cancel-fail-authorize'),
    }).expect(201);

    jest
      .spyOn(context.pointsProvider, 'cancel')
      .mockRejectedValueOnce(new Error('simulated cancel compensation failure'));

    const cancelled = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/cancel`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-cancel-fail-cancel'),
    }).expect(201);

    expect(cancelled.body.data.status).toBe('RECONCILE_REQUIRED');

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow?.status).toBe('RECONCILE_REQUIRED');

    const [legRow] = await context.dbService.db
      .select({ status: paymentLegs.status })
      .from(paymentLegs)
      .where(eq(paymentLegs.id, leg.id))
      .limit(1);
    expect(legRow?.status).toBe('RECONCILE_REQUIRED');

    const [queueItem] = await context.dbService.db
      .select({
        id: manualCancelQueueItems.id,
        actionType: manualCancelQueueItems.actionType,
        status: manualCancelQueueItems.status,
      })
      .from(manualCancelQueueItems)
      .where(
        and(
          eq(manualCancelQueueItems.intentId, intentId),
          eq(manualCancelQueueItems.legId, leg.id),
        ),
      )
      .limit(1);

    expect(queueItem).toBeDefined();
    expect(queueItem?.actionType).toBe('CANCEL');
    expect(queueItem?.status).toBe('QUEUED');

    const [reconcileEvent] = await context.dbService.db
      .select({
        payload: outboxEvents.payload,
      })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, intentId),
          eq(outboxEvents.eventType, 'PaymentReconcileRequired'),
        ),
      )
      .orderBy(desc(outboxEvents.createdAt))
      .limit(1);

    expect(reconcileEvent).toBeDefined();
    const payload = reconcileEvent?.payload as
      | {
          reasonCode?: string;
          manualQueueItemId?: string | null;
          manualQueueItemIds?: string[];
        }
      | undefined;
    expect(payload?.reasonCode).toBe('INTENT_CANCEL_RECONCILE_REQUIRED');
    expect(payload?.manualQueueItemId).toBe(queueItem?.id);
    expect(payload?.manualQueueItemIds).toContain(queueItem?.id);
  });

  it('enqueues manual refund queue and emits reconcile-required event when supersede compensation fails', async () => {
    const intentId = await createPendingIntent(
      context,
      'phase3-compensation-supersede-fail',
    );
    const legs = await configureTwoLegs(context, intentId);
    const capturedLeg = legs.find((leg) => leg.sequenceNo === 1);

    expect(capturedLeg).toBeDefined();

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${capturedLeg!.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-sup-fail-authorize'),
    }).expect(201);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${capturedLeg!.id}/capture`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-sup-fail-capture'),
    }).expect(201);

    jest
      .spyOn(context.pointsProvider, 'refund')
      .mockRejectedValueOnce(new Error('simulated refund compensation failure'));

    const superseded = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/supersede`,
      idempotencyKey: phase2ScopedValue('idem-phase3-comp-sup-fail-supersede'),
    }).expect(201);

    expect(superseded.body.data.status).toBe('SUPERSEDED_RECONCILE_REQUIRED');

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow?.status).toBe('SUPERSEDED_RECONCILE_REQUIRED');

    const [capturedLegRow] = await context.dbService.db
      .select({ status: paymentLegs.status })
      .from(paymentLegs)
      .where(eq(paymentLegs.id, capturedLeg!.id))
      .limit(1);
    expect(capturedLegRow?.status).toBe('RECONCILE_REQUIRED');

    const [queueItem] = await context.dbService.db
      .select({
        id: manualCancelQueueItems.id,
        actionType: manualCancelQueueItems.actionType,
        status: manualCancelQueueItems.status,
      })
      .from(manualCancelQueueItems)
      .where(
        and(
          eq(manualCancelQueueItems.intentId, intentId),
          eq(manualCancelQueueItems.legId, capturedLeg!.id),
        ),
      )
      .limit(1);

    expect(queueItem).toBeDefined();
    expect(queueItem?.actionType).toBe('REFUND');
    expect(queueItem?.status).toBe('QUEUED');

    const [reconcileEvent] = await context.dbService.db
      .select({
        payload: outboxEvents.payload,
      })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, intentId),
          eq(outboxEvents.eventType, 'PaymentReconcileRequired'),
        ),
      )
      .orderBy(desc(outboxEvents.createdAt))
      .limit(1);

    expect(reconcileEvent).toBeDefined();
    const payload = reconcileEvent?.payload as
      | {
          reasonCode?: string;
          manualQueueItemId?: string | null;
          manualQueueItemIds?: string[];
        }
      | undefined;
    expect(payload?.reasonCode).toBe('INTENT_SUPERSEDE_RECONCILE_REQUIRED');
    expect(payload?.manualQueueItemId).toBe(queueItem?.id);
    expect(payload?.manualQueueItemIds).toContain(queueItem?.id);
  });
});

async function createPendingIntent(
  context: WalletIntegrationContext,
  referenceLabel: string,
): Promise<string> {
  const referenceId = phase2ScopedValue(`ref-${referenceLabel}`);
  const customerId = phase2ScopedValue(`customer-${referenceLabel}`);
  const body = createSignedCreateIntentBody({
    referenceId,
    customerId,
    payableAmount: 10000,
    snapshotPayload: {
      referenceType: 'STORE_ORDER',
      referenceId,
      currency: 'KRW',
      payableAmount: 10000,
    },
  });

  const response = await sendWriteRequest({
    app: context.app,
    method: 'post',
    path: '/v1/intents',
    body,
    idempotencyKey: phase2ScopedValue(`idem-create-${referenceLabel}`),
  }).expect(201);

  return response.body.data.id as string;
}

async function configureTwoLegs(
  context: WalletIntegrationContext,
  intentId: string,
): Promise<Array<{ id: string; sequenceNo: number }>> {
  await sendWriteRequest({
    app: context.app,
    method: 'put',
    path: `/v1/intents/${intentId}/legs`,
    body: {
      legs: [
        {
          providerType: 'POINTS',
          amount: 6000,
          sequenceNo: 1,
          isRequired: true,
        },
        {
          providerType: 'POINTS',
          amount: 4000,
          sequenceNo: 2,
          isRequired: true,
        },
      ],
    },
    idempotencyKey: phase2ScopedValue(`idem-configure-${intentId}`),
  }).expect(200);

  return context.dbService.db
    .select({
      id: paymentLegs.id,
      sequenceNo: paymentLegs.sequenceNo,
    })
    .from(paymentLegs)
    .where(eq(paymentLegs.intentId, intentId));
}

async function configureSingleLeg(
  context: WalletIntegrationContext,
  intentId: string,
  amount: number,
): Promise<Array<{ id: string; sequenceNo: number }>> {
  await sendWriteRequest({
    app: context.app,
    method: 'put',
    path: `/v1/intents/${intentId}/legs`,
    body: {
      legs: [
        {
          providerType: 'POINTS',
          amount,
          sequenceNo: 1,
          isRequired: true,
        },
      ],
    },
    idempotencyKey: phase2ScopedValue(`idem-configure-single-${intentId}`),
  }).expect(200);

  return context.dbService.db
    .select({
      id: paymentLegs.id,
      sequenceNo: paymentLegs.sequenceNo,
    })
    .from(paymentLegs)
    .where(eq(paymentLegs.intentId, intentId));
}
