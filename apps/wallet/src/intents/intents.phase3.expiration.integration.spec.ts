import { and, desc, eq } from 'drizzle-orm';
import {
  manualCancelQueueItems,
  outboxEvents,
  paymentIntents,
  paymentLegs,
} from '../schema';
import { IntentsService } from './intents.service';
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

describeWalletDbIntegration('Intents phase3 expiration integration (real path)', () => {
  let context: WalletIntegrationContext;
  let intentsService: IntentsService;

  beforeAll(async () => {
    context = await createWalletIntegrationContext();
    intentsService = context.module.get(IntentsService);
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanupPhase2TestData(context.dbService);
    await closeWalletIntegrationContext(context);
  });

  it('moves expired PENDING intent directly to EXPIRED', async () => {
    const intentId = await createPendingIntent(context, 'phase3-expire-pending');
    await markIntentExpired(context, intentId);

    const result = await intentsService.expireIntent(
      intentId,
      phase2ScopedValue('corr-phase3-expire-pending'),
    );

    expect(result.status).toBe('EXPIRED');

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow?.status).toBe('EXPIRED');
  });

  it('expires PARTIALLY_CAPTURED intent after cancel/refund compensation succeeds', async () => {
    const intentId = await createPendingIntent(
      context,
      'phase3-expire-partially-captured',
    );
    const legs = await configureTwoLegs(context, intentId);
    const capturedLeg = legs.find((leg) => leg.sequenceNo === 1);
    const authorizedLeg = legs.find((leg) => leg.sequenceNo === 2);

    expect(capturedLeg).toBeDefined();
    expect(authorizedLeg).toBeDefined();

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${capturedLeg!.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-expire-partial-authorize-captured'),
    }).expect(201);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${capturedLeg!.id}/capture`,
      idempotencyKey: phase2ScopedValue('idem-phase3-expire-partial-capture'),
    }).expect(201);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${authorizedLeg!.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-expire-partial-authorize-authorized'),
    }).expect(201);

    await markIntentExpired(context, intentId);

    const result = await intentsService.expireIntent(
      intentId,
      phase2ScopedValue('corr-phase3-expire-partial'),
    );

    expect(result.status).toBe('EXPIRED');

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow?.status).toBe('EXPIRED');

    const legRows = await context.dbService.db
      .select({
        id: paymentLegs.id,
        sequenceNo: paymentLegs.sequenceNo,
        status: paymentLegs.status,
      })
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intentId));

    const capturedLegRow = legRows.find((leg) => leg.sequenceNo === 1);
    const authorizedLegRow = legRows.find((leg) => leg.sequenceNo === 2);

    expect(capturedLegRow?.status).toBe('REFUNDED');
    expect(authorizedLegRow?.status).toBe('CANCELLED');
  });

  it('moves to RECONCILE_REQUIRED and emits queue/event when expiration compensation fails', async () => {
    const intentId = await createPendingIntent(
      context,
      'phase3-expire-compensation-failure',
    );
    const [leg] = await configureSingleLeg(context, intentId, 10000);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-expire-fail-authorize'),
    }).expect(201);

    await markIntentExpired(context, intentId);

    const originalExecute = context.pointsProvider.execute.bind(context.pointsProvider);
    jest.spyOn(context.pointsProvider, 'execute').mockImplementation(async (command) => {
      if (command.op === 'CANCEL') {
        throw new Error('simulated expiration cancel failure');
      }
      return originalExecute(command);
    });

    const result = await intentsService.expireIntent(
      intentId,
      phase2ScopedValue('corr-phase3-expire-fail'),
    );

    expect(result.status).toBe('RECONCILE_REQUIRED');

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
    expect(payload?.reasonCode).toBe('INTENT_EXPIRE_RECONCILE_REQUIRED');
    expect(payload?.manualQueueItemId).toBe(queueItem?.id);
    expect(payload?.manualQueueItemIds).toContain(queueItem?.id);
  });
});

async function createPendingIntent(
  context: WalletIntegrationContext,
  referenceLabel: string,
  payableAmount = 10000,
): Promise<string> {
  const referenceId = phase2ScopedValue(`ref-${referenceLabel}`);
  const userId = phase2ScopedValue(`customer-${referenceLabel}`);
  const body = createSignedCreateIntentBody({
    referenceId,
    userId,
    payableAmount,
    snapshotPayload: {
      referenceType: 'STORE_ORDER',
      referenceId,
      currency: 'KRW',
      payableAmount,
    },
  });

  const created = await sendWriteRequest({
    app: context.app,
    method: 'post',
    path: '/v1/intents',
    body,
    idempotencyKey: phase2ScopedValue(`idem-create-${referenceLabel}`),
  }).expect(201);

  return created.body.data.id as string;
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
    idempotencyKey: phase2ScopedValue(`idem-configure-two-${intentId}`),
  }).expect(200);

  return context.dbService.db
    .select({
      id: paymentLegs.id,
      sequenceNo: paymentLegs.sequenceNo,
    })
    .from(paymentLegs)
    .where(eq(paymentLegs.intentId, intentId));
}

async function markIntentExpired(
  context: WalletIntegrationContext,
  intentId: string,
): Promise<void> {
  await context.dbService.db
    .update(paymentIntents)
    .set({
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(),
    })
    .where(eq(paymentIntents.id, intentId));
}
