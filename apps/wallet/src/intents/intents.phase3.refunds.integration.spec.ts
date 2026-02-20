import { and, eq } from 'drizzle-orm';
import * as request from 'supertest';
import { manualCancelQueueItems, paymentLegs, refundRequests } from '../schema';
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

describeWalletDbIntegration('Intents phase3 refunds integration (real path)', () => {
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

  it('creates refund request and serves detail lookup', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'phase3-refund-create',
      10000,
    );

    const created = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/refund-requests`,
      body: {
        refundAmount: 4000,
        allocation: [{ legId, amount: 4000 }],
        reasonCode: 'CUSTOMER_REQUEST',
        reasonMessage: 'partial refund',
      },
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-create'),
    }).expect(201);

    expect(created.body.success).toBe(true);
    expect(created.body.data.refundRequest.intentId).toBe(intentId);
    expect(created.body.data.refundRequest.status).toBe('COMPLETED');
    expect(created.body.data.allocations).toHaveLength(1);

    const refundId = created.body.data.refundRequest.id as string;

    const fetched = await request(context.app.getHttpServer())
      .get(`/v1/refund-requests/${refundId}`)
      .expect(200);

    expect(fetched.body.success).toBe(true);
    expect(fetched.body.data.refundRequest.id).toBe(refundId);
    expect(fetched.body.data.refundRequest.status).toBe('COMPLETED');
    expect(fetched.body.data.allocations[0].legId).toBe(legId);

    const [legRow] = await context.dbService.db
      .select({ status: paymentLegs.status })
      .from(paymentLegs)
      .where(eq(paymentLegs.id, legId))
      .limit(1);

    expect(legRow?.status).toBe('CAPTURED');
  });

  it('rejects refund request when allocation sum mismatches refundAmount', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'phase3-refund-sum-mismatch',
      10000,
    );

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/refund-requests`,
      body: {
        refundAmount: 5000,
        allocation: [{ legId, amount: 4000 }],
        reasonCode: 'CUSTOMER_REQUEST',
      },
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-sum-mismatch'),
    }).expect(400);

    expect(response.body.error).toBe('ALLOCATION_INVALID');
  });

  it('rejects refund request when allocation targets non-captured leg', async () => {
    const intentId = await createPendingIntent(context, 'phase3-refund-non-captured');

    await sendWriteRequest({
      app: context.app,
      method: 'put',
      path: `/v1/intents/${intentId}/legs`,
      body: {
        legs: [
          {
            providerType: 'POINTS',
            amount: 9000,
            sequenceNo: 1,
            isRequired: true,
          },
          {
            providerType: 'POINTS',
            amount: 1000,
            sequenceNo: 2,
            isRequired: false,
          },
        ],
      },
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-non-captured-configure'),
    }).expect(200);

    const legs = await context.dbService.db
      .select({
        id: paymentLegs.id,
        sequenceNo: paymentLegs.sequenceNo,
      })
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intentId));

    const capturedTargetLeg = legs.find((leg) => leg.sequenceNo === 1);
    const nonCapturedLeg = legs.find((leg) => leg.sequenceNo === 2);

    expect(capturedTargetLeg).toBeDefined();
    expect(nonCapturedLeg).toBeDefined();

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${capturedTargetLeg!.id}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-non-captured-authorize'),
    }).expect(201);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${capturedTargetLeg!.id}/capture`,
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-non-captured-capture'),
    }).expect(201);

    const intentState = await request(context.app.getHttpServer())
      .get(`/v1/intents/${intentId}`)
      .expect(200);
    expect(intentState.body.data.status).toBe('SUCCEEDED');

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/refund-requests`,
      body: {
        refundAmount: 1000,
        allocation: [{ legId: nonCapturedLeg!.id, amount: 1000 }],
        reasonCode: 'CUSTOMER_REQUEST',
      },
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-non-captured'),
    }).expect(400);

    expect(response.body.error).toBe('ALLOCATION_INVALID');
  });

  it('rejects refund request when cumulative leg refund exceeds captured amount', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'phase3-refund-limit',
      10000,
    );

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/refund-requests`,
      body: {
        refundAmount: 7000,
        allocation: [{ legId, amount: 7000 }],
        reasonCode: 'CUSTOMER_REQUEST',
      },
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-limit-first'),
    }).expect(201);

    const second = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/refund-requests`,
      body: {
        refundAmount: 4000,
        allocation: [{ legId, amount: 4000 }],
        reasonCode: 'CUSTOMER_REQUEST',
      },
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-limit-second'),
    }).expect(400);

    expect(second.body.error).toBe('REFUND_LIMIT_EXCEEDED');
  });

  it('marks refund as reconcile-required and enqueues manual item on provider refund failure', async () => {
    const { intentId, legId } = await createCapturedIntent(
      context,
      'phase3-refund-provider-failure',
      10000,
    );

    const originalExecute = context.pointsProvider.execute.bind(context.pointsProvider);
    jest.spyOn(context.pointsProvider, 'execute').mockImplementation(async (command) => {
      if (command.op === 'REFUND') {
        throw new Error('simulated provider refund failure');
      }
      return originalExecute(command);
    });

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/refund-requests`,
      body: {
        refundAmount: 10000,
        allocation: [{ legId, amount: 10000 }],
        reasonCode: 'CUSTOMER_REQUEST',
      },
      idempotencyKey: phase2ScopedValue('idem-phase3-refund-provider-failure'),
    }).expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.refundRequest.status).toBe('RECONCILE_REQUIRED');

    const [refundRow] = await context.dbService.db
      .select({ status: refundRequests.status })
      .from(refundRequests)
      .where(eq(refundRequests.id, response.body.data.refundRequest.id as string))
      .limit(1);
    expect(refundRow?.status).toBe('RECONCILE_REQUIRED');

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
    expect(queueItem?.actionType).toBe('REFUND');
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
    idempotencyKey: phase2ScopedValue(`idem-authorize-${label}`),
  }).expect(201);

  await sendWriteRequest({
    app: context.app,
    method: 'post',
    path: `/v1/intents/${intentId}/legs/${leg.id}/capture`,
    idempotencyKey: phase2ScopedValue(`idem-capture-${label}`),
  }).expect(201);

  return {
    intentId,
    legId: leg.id,
  };
}
