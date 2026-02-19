import { and, desc, eq, sql } from 'drizzle-orm';
import {
  manualCancelQueueItems,
  outboxEvents,
  paymentAttempts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
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
} from '../intents/test-helpers/wallet-test-app';

jest.setTimeout(180_000);

describeWalletDbIntegration('Reconcile service integration (real path)', () => {
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

  it('resolves UNKNOWN refund attempt to REFUNDED when provider status is REFUNDED', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'reconcile-refund-resolved',
      10000,
    );

    await context.dbService.db
      .update(paymentLegs)
      .set({
        status: 'REFUNDING',
        updatedAt: new Date(),
      })
      .where(eq(paymentLegs.id, legId));

    const attemptId = await insertUnknownAttempt(context, {
      intentId,
      legId,
      operation: 'REFUND',
    });

    jest.spyOn(context.pointsProvider, 'getTransaction').mockResolvedValueOnce({
      providerTransactionId: phase2ScopedValue('reconcile-refunded-provider-tx'),
      status: 'REFUNDED',
      raw: {
        providerType: 'POINTS',
      },
    });

    await context.reconcileService.runBatch(
      'MANUAL',
      phase2ScopedValue('corr-reconcile-refund-resolved'),
    );

    const [attemptRow] = await context.dbService.db
      .select({ status: paymentAttempts.status })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .limit(1);
    expect(attemptRow?.status).toBe('REFUNDED');

    const [legRow] = await context.dbService.db
      .select({ status: paymentLegs.status })
      .from(paymentLegs)
      .where(eq(paymentLegs.id, legId))
      .limit(1);
    expect(legRow?.status).toBe('REFUNDED');
  });

  it('moves unresolved UNKNOWN cancel attempt to RECONCILE_REQUIRED and enqueues manual item', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'reconcile-cancel-unresolved',
      10000,
    );

    await context.dbService.db
      .update(paymentLegs)
      .set({
        status: 'CANCELING',
        updatedAt: new Date(),
      })
      .where(eq(paymentLegs.id, legId));

    const attemptId = await insertUnknownAttempt(context, {
      intentId,
      legId,
      operation: 'CANCEL',
    });

    await context.reconcileService.runBatch(
      'MANUAL',
      phase2ScopedValue('corr-reconcile-cancel-unresolved'),
    );

    const [attemptRow] = await context.dbService.db
      .select({ status: paymentAttempts.status })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .limit(1);
    expect(attemptRow?.status).toBe('RECONCILE_REQUIRED');

    const [legRow] = await context.dbService.db
      .select({ status: paymentLegs.status })
      .from(paymentLegs)
      .where(eq(paymentLegs.id, legId))
      .limit(1);
    expect(legRow?.status).toBe('RECONCILE_REQUIRED');

    const [queueItem] = await context.dbService.db
      .select({
        id: manualCancelQueueItems.id,
        status: manualCancelQueueItems.status,
        actionType: manualCancelQueueItems.actionType,
      })
      .from(manualCancelQueueItems)
      .where(
        and(
          eq(manualCancelQueueItems.intentId, intentId),
          eq(manualCancelQueueItems.legId, legId),
        ),
      )
      .limit(1);

    expect(queueItem).toBeDefined();
    expect(queueItem?.status).toBe('QUEUED');
    expect(queueItem?.actionType).toBe('CANCEL');
  });

  it('finalizes RECONCILING intent to CANCELLED when compensation is fully resolved', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'reconcile-intent-finalize-cancelled',
      10000,
    );

    await context.dbService.db
      .update(paymentLegs)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(eq(paymentLegs.id, legId));

    await context.dbService.db
      .update(paymentIntents)
      .set({
        status: 'RECONCILING',
        updatedAt: new Date(),
      })
      .where(eq(paymentIntents.id, intentId));

    await context.dbService.db.insert(paymentStateTransitions).values({
      entityType: 'INTENT',
      entityId: intentId,
      previousStatus: 'PARTIALLY_CAPTURED',
      newStatus: 'RECONCILING',
      reasonCode: 'INTENT_CANCEL_RECONCILING',
      reasonMessage: 'test setup for reconcile finalize',
      triggeredByType: 'SYSTEM',
      triggeredById: 'test',
      correlationId: phase2ScopedValue('corr-reconcile-intent-setup'),
      occurredAt: new Date(),
      payload: {
        operation: 'CANCEL',
      },
    });

    await context.reconcileService.runBatch(
      'MANUAL',
      phase2ScopedValue('corr-reconcile-intent-finalize'),
    );

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);

    expect(intentRow?.status).toBe('CANCELLED');
  });

  it('retryIntent resolves RECONCILE_REQUIRED intent and leg to terminal state', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'reconcile-retry-intent-required',
      10000,
    );

    await context.dbService.db
      .update(paymentLegs)
      .set({
        status: 'RECONCILE_REQUIRED',
        updatedAt: new Date(),
      })
      .where(eq(paymentLegs.id, legId));

    await context.dbService.db
      .update(paymentIntents)
      .set({
        status: 'RECONCILE_REQUIRED',
        updatedAt: new Date(),
      })
      .where(eq(paymentIntents.id, intentId));

    await context.dbService.db.insert(paymentStateTransitions).values({
      entityType: 'INTENT',
      entityId: intentId,
      previousStatus: 'PARTIALLY_CAPTURED',
      newStatus: 'RECONCILING',
      reasonCode: 'INTENT_CANCEL_RECONCILING',
      reasonMessage: 'test setup for reconcile retry',
      triggeredByType: 'SYSTEM',
      triggeredById: 'test',
      correlationId: phase2ScopedValue('corr-reconcile-retry-setup-1'),
      occurredAt: new Date(),
      payload: { operation: 'CANCEL' },
    });

    await context.dbService.db.insert(paymentStateTransitions).values({
      entityType: 'INTENT',
      entityId: intentId,
      previousStatus: 'RECONCILING',
      newStatus: 'RECONCILE_REQUIRED',
      reasonCode: 'INTENT_CANCEL_RECONCILE_REQUIRED',
      reasonMessage: 'test setup for reconcile retry',
      triggeredByType: 'SYSTEM',
      triggeredById: 'test',
      correlationId: phase2ScopedValue('corr-reconcile-retry-setup-2'),
      occurredAt: new Date(),
      payload: { operation: 'CANCEL' },
    });

    jest.spyOn(context.pointsProvider, 'getTransaction').mockResolvedValueOnce({
      providerTransactionId: phase2ScopedValue('retry-intent-resolved-provider-tx'),
      status: 'CANCELLED',
      raw: {
        providerType: 'POINTS',
      },
    });

    const result = await context.reconcileService.retryIntent(intentId, {
      reasonCode: 'ADMIN_RETRY',
      reasonMessage: 'operator retry',
      actorId: phase2ScopedValue('actor-reconcile-retry'),
      correlationId: phase2ScopedValue('corr-reconcile-retry'),
    });

    expect(result.status).toBe('CANCELLED');

    const [legRow] = await context.dbService.db
      .select({ status: paymentLegs.status })
      .from(paymentLegs)
      .where(eq(paymentLegs.id, legId))
      .limit(1);
    expect(legRow?.status).toBe('CANCELLED');

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow?.status).toBe('CANCELLED');
  });

  it('retryIntent resolves SUPERSEDED_RECONCILE_REQUIRED intent to SUPERSEDED', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'reconcile-retry-intent-superseded',
      10000,
    );

    await context.dbService.db
      .update(paymentLegs)
      .set({
        status: 'RECONCILE_REQUIRED',
        updatedAt: new Date(),
      })
      .where(eq(paymentLegs.id, legId));

    await context.dbService.db
      .update(paymentIntents)
      .set({
        status: 'SUPERSEDED_RECONCILE_REQUIRED',
        updatedAt: new Date(),
      })
      .where(eq(paymentIntents.id, intentId));

    jest.spyOn(context.pointsProvider, 'getTransaction').mockResolvedValueOnce({
      providerTransactionId: phase2ScopedValue('retry-superseded-provider-tx'),
      status: 'REFUNDED',
      raw: {
        providerType: 'POINTS',
      },
    });

    const result = await context.reconcileService.retryIntent(intentId, {
      reasonCode: 'ADMIN_RETRY',
      reasonMessage: 'operator retry superseded',
      actorId: phase2ScopedValue('actor-reconcile-retry-superseded'),
      correlationId: phase2ScopedValue('corr-reconcile-retry-superseded'),
    });

    expect(result.status).toBe('SUPERSEDED');

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow?.status).toBe('SUPERSEDED');
  });

  it('reuses open manual queue item on repeated unresolved reconcile runs', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'reconcile-manual-queue-dedup',
      10000,
    );

    await context.dbService.db
      .update(paymentLegs)
      .set({
        status: 'RECONCILE_REQUIRED',
        updatedAt: new Date(),
      })
      .where(eq(paymentLegs.id, legId));

    jest.spyOn(context.pointsProvider, 'getTransaction').mockResolvedValue({
      providerTransactionId: phase2ScopedValue('reconcile-manual-queue-dedup-tx'),
      status: 'PENDING',
      raw: {
        providerType: 'POINTS',
      },
    });

    await context.reconcileService.runBatch(
      'MANUAL',
      phase2ScopedValue('corr-reconcile-manual-queue-dedup-1'),
    );
    await context.reconcileService.runBatch(
      'MANUAL',
      phase2ScopedValue('corr-reconcile-manual-queue-dedup-2'),
    );

    const queueItems = await context.dbService.db
      .select({
        id: manualCancelQueueItems.id,
        retryCount: manualCancelQueueItems.retryCount,
        status: manualCancelQueueItems.status,
      })
      .from(manualCancelQueueItems)
      .where(
        and(
          eq(manualCancelQueueItems.intentId, intentId),
          eq(manualCancelQueueItems.legId, legId),
        ),
      );

    expect(queueItems).toHaveLength(1);
    expect(queueItems[0].status).toBe('QUEUED');
    expect(queueItems[0].retryCount).toBeGreaterThanOrEqual(1);
  });

  it('emits reconcile-required event with manual queue ids when RECONCILING intent remains unresolved', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'reconcile-required-event-payload',
      10000,
    );

    await context.dbService.db
      .update(paymentLegs)
      .set({
        status: 'RECONCILE_REQUIRED',
        updatedAt: new Date(),
      })
      .where(eq(paymentLegs.id, legId));

    await context.dbService.db
      .update(paymentIntents)
      .set({
        status: 'RECONCILING',
        updatedAt: new Date(),
      })
      .where(eq(paymentIntents.id, intentId));

    await context.dbService.db.insert(paymentStateTransitions).values({
      entityType: 'INTENT',
      entityId: intentId,
      previousStatus: 'PARTIALLY_CAPTURED',
      newStatus: 'RECONCILING',
      reasonCode: 'INTENT_CANCEL_RECONCILING',
      reasonMessage: 'test setup for reconcile-required event payload',
      triggeredByType: 'SYSTEM',
      triggeredById: 'test',
      correlationId: phase2ScopedValue('corr-reconcile-required-event-payload-setup'),
      occurredAt: new Date(),
      payload: { operation: 'CANCEL' },
    });

    const insertedQueueItems = await context.dbService.db
      .insert(manualCancelQueueItems)
      .values({
        intentId,
        legId,
        actionType: 'CANCEL',
        status: 'QUEUED',
        reasonCode: 'TEST_RECONCILE_REQUIRED',
      })
      .returning({ id: manualCancelQueueItems.id });
    const queueItemId = insertedQueueItems[0].id;

    await context.reconcileService.runBatch(
      'MANUAL',
      phase2ScopedValue('corr-reconcile-required-event-payload-run'),
    );

    const [intentRow] = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow?.status).toBe('RECONCILE_REQUIRED');

    const [eventRow] = await context.dbService.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, intentId),
          eq(outboxEvents.eventType, 'PaymentReconcileRequired'),
        ),
      )
      .orderBy(desc(outboxEvents.createdAt))
      .limit(1);

    expect(eventRow).toBeDefined();

    const payload = eventRow?.payload as
      | {
          reasonCode?: string;
          payableAmount?: number;
          currency?: string;
          manualQueueItemId?: string | null;
          manualQueueItemIds?: string[];
        }
      | undefined;

    expect(payload?.reasonCode).toBe('INTENT_RECONCILE_REQUIRED');
    expect(payload?.payableAmount).toBe(10000);
    expect(payload?.currency).toBe('KRW');
    expect(payload?.manualQueueItemId).toBe(queueItemId);
    expect(payload?.manualQueueItemIds).toContain(queueItemId);
  });
});

async function createPendingIntent(
  context: WalletIntegrationContext,
  referenceLabel: string,
  payableAmount = 10000,
): Promise<string> {
  const referenceId = phase2ScopedValue(`ref-${referenceLabel}`);
  const customerId = phase2ScopedValue(`customer-${referenceLabel}`);
  const body = createSignedCreateIntentBody({
    referenceId,
    customerId,
    payableAmount,
    snapshotPayload: {
      referenceType: 'STORE_ORDER',
      referenceId,
      currency: 'KRW',
      payableAmount,
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

async function configureSinglePointsLeg(
  context: WalletIntegrationContext,
  intentId: string,
  amount: number,
): Promise<Array<{ id: string }>> {
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
    idempotencyKey: phase2ScopedValue(`idem-configure-leg-${intentId}`),
  }).expect(200);

  return context.dbService.db
    .select({ id: paymentLegs.id })
    .from(paymentLegs)
    .where(eq(paymentLegs.intentId, intentId));
}

async function createCapturedIntent(
  context: WalletIntegrationContext,
  label: string,
  amount: number,
): Promise<{ intentId: string; legId: string }> {
  const intentId = await createPendingIntent(context, label, amount);
  const [leg] = await configureSinglePointsLeg(context, intentId, amount);

  await sendWriteRequest({
    app: context.app,
    method: 'post',
    path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
    idempotencyKey: phase2ScopedValue(`idem-reconcile-authorize-${label}`),
  }).expect(201);

  await sendWriteRequest({
    app: context.app,
    method: 'post',
    path: `/v1/intents/${intentId}/legs/${leg.id}/capture`,
    idempotencyKey: phase2ScopedValue(`idem-reconcile-capture-${label}`),
  }).expect(201);

  return {
    intentId,
    legId: leg.id,
  };
}

async function insertUnknownAttempt(
  context: WalletIntegrationContext,
  input: {
    intentId: string;
    legId: string;
    operation: 'CANCEL' | 'REFUND';
  },
): Promise<string> {
  const maxAttemptRows = await context.dbService.db
    .select({
      maxAttemptNo: sql<number>`coalesce(max(${paymentAttempts.attemptNo}), 0)`,
    })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.legId, input.legId));

  const attemptNo = Number(maxAttemptRows[0]?.maxAttemptNo ?? 0) + 1;

  const inserted = await context.dbService.db
    .insert(paymentAttempts)
    .values({
      intentId: input.intentId,
      legId: input.legId,
      attemptNo,
      operation: input.operation,
      status: 'UNKNOWN',
      providerIdempotencyKey: `wallet:test:${input.legId}:${input.operation}:${attemptNo}`,
      requestPayload: {
        operation: input.operation,
      },
    })
    .returning({ id: paymentAttempts.id });

  return inserted[0].id;
}
