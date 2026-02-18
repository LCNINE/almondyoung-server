import { eq } from 'drizzle-orm';
import { paymentIntents, paymentLegs } from '../schema';
import {
  WalletIntegrationContext,
  cleanupPhase2TestData,
  closeWalletIntegrationContext,
  createDeferred,
  createSignedCreateIntentBody,
  createWalletIntegrationContext,
  describeWalletDbIntegration,
  phase2ScopedValue,
  sendWriteRequest,
  waitUntil,
} from './test-helpers/wallet-test-app';

jest.setTimeout(180_000);

describeWalletDbIntegration('Intents phase2 idempotency integration (real path)', () => {
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

  it('replays stored response for same key and same payload', async () => {
    const referenceId = phase2ScopedValue('ref-idempotency-replay');
    const customerId = phase2ScopedValue('customer-idempotency-replay');
    const idempotencyKey = phase2ScopedValue('idem-replay-create');

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

    const first = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey,
    }).expect(201);

    const second = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey,
    }).expect(201);

    expect(second.body).toEqual(first.body);

    const intents = await context.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(eq(paymentIntents.referenceId, referenceId));
    expect(intents).toHaveLength(1);
  });

  it('returns 409 for same key and different payload', async () => {
    const referenceId = phase2ScopedValue('ref-idempotency-conflict');
    const customerId = phase2ScopedValue('customer-idempotency-conflict');
    const idempotencyKey = phase2ScopedValue('idem-conflict-create');

    const firstBody = createSignedCreateIntentBody({
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

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body: firstBody,
      idempotencyKey,
    }).expect(201);

    const secondBody = createSignedCreateIntentBody({
      referenceId,
      customerId,
      payableAmount: 9000,
      snapshotPayload: {
        referenceType: 'STORE_ORDER',
        referenceId,
        currency: 'KRW',
        payableAmount: 9000,
      },
    });

    const second = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body: secondBody,
      idempotencyKey,
    }).expect(409);

    expect(second.body.error).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('returns 409 while same idempotency key request is in progress', async () => {
    const intentId = await createPendingIntent(context, 'idem-in-progress');
    const [leg] = await configureSinglePointsLeg(context, intentId);
    const idempotencyKey = phase2ScopedValue('idem-in-progress-authorize');
    const actorId = phase2ScopedValue('actor-idem-in-progress');

    const deferred = createDeferred<{
      resultStatus: 'AUTHORIZED';
      providerTransactionId: string;
      providerRequestId: string;
      raw: Record<string, unknown>;
    }>();

    const authorizeSpy = jest
      .spyOn(context.pointsProvider, 'authorize')
      .mockImplementationOnce(() => deferred.promise);

    const firstRequest = sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
      idempotencyKey,
      actorId,
    }).expect(201);
    void firstRequest.then(
      () => undefined,
      () => undefined,
    );

    let isProviderResolved = false;
    const resolveProvider = () => {
      if (isProviderResolved) {
        return;
      }

      isProviderResolved = true;
      deferred.resolve({
        resultStatus: 'AUTHORIZED',
        providerTransactionId: phase2ScopedValue('auth-tx-idem'),
        providerRequestId: phase2ScopedValue('auth-req-idem'),
        raw: {
          providerType: 'POINTS',
        },
      });
    };

    try {
      await waitUntil(() => authorizeSpy.mock.calls.length === 1, 10_000);

      const second = await sendWriteRequest({
        app: context.app,
        method: 'post',
        path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
        idempotencyKey,
        actorId,
      }).expect(409);

      expect(second.body.error).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');

      resolveProvider();

      const first = await firstRequest;
      expect(first.body.success).toBe(true);
      expect(first.body.data.leg.status).toBe('AUTHORIZED');
    } finally {
      resolveProvider();
      await firstRequest.then(
        () => undefined,
        () => undefined,
      );
    }
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

async function configureSinglePointsLeg(
  context: WalletIntegrationContext,
  intentId: string,
): Promise<Array<{ id: string }>> {
  await sendWriteRequest({
    app: context.app,
    method: 'put',
    path: `/v1/intents/${intentId}/legs`,
    idempotencyKey: phase2ScopedValue(`idem-configure-${intentId}`),
    actorId: phase2ScopedValue('actor-configure-single-leg'),
    body: {
      legs: [
        {
          providerType: 'POINTS',
          amount: 10000,
          sequenceNo: 1,
          isRequired: true,
        },
      ],
    },
  }).expect(200);

  return context.dbService.db
    .select({ id: paymentLegs.id })
    .from(paymentLegs)
    .where(eq(paymentLegs.intentId, intentId));
}
