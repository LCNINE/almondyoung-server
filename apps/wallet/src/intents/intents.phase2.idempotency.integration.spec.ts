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
  sendWriteRequest,
  waitUntil,
} from './test-helpers/wallet-test-app';

jest.setTimeout(60_000);

describeWalletDbIntegration('Intents phase2 idempotency integration (real path)', () => {
  let context: WalletIntegrationContext;

  beforeAll(async () => {
    context = await createWalletIntegrationContext();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanupPhase2TestData(context.dbService);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanupPhase2TestData(context.dbService);
    await closeWalletIntegrationContext(context);
  });

  it('replays stored response for same key and same payload', async () => {
    const body = createSignedCreateIntentBody({
      referenceId: 'phase2-ref-idempotency-replay',
      customerId: 'phase2-customer-idempotency-replay',
      payableAmount: 10000,
      snapshotPayload: {
        referenceType: 'STORE_ORDER',
        referenceId: 'phase2-ref-idempotency-replay',
        currency: 'KRW',
        payableAmount: 10000,
      },
    });

    const first = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey: 'phase2-idem-replay-create',
    }).expect(201);

    const second = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey: 'phase2-idem-replay-create',
    }).expect(201);

    expect(second.body).toEqual(first.body);

    const intents = await context.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(eq(paymentIntents.referenceId, 'phase2-ref-idempotency-replay'));
    expect(intents).toHaveLength(1);
  });

  it('returns 409 for same key and different payload', async () => {
    const referenceId = 'phase2-ref-idempotency-conflict';
    const customerId = 'phase2-customer-idempotency-conflict';

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
      idempotencyKey: 'phase2-idem-conflict-create',
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
      idempotencyKey: 'phase2-idem-conflict-create',
    }).expect(409);

    expect(second.body.error).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('returns 409 while same idempotency key request is in progress', async () => {
    const intentId = await createPendingIntent(context, 'phase2-idem-in-progress');
    const [leg] = await configureSinglePointsLeg(context, intentId);

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
      idempotencyKey: 'phase2-idem-in-progress-authorize',
      actorId: 'phase2-actor-idem-in-progress',
    }).expect(201);
    void firstRequest.then(
      () => undefined,
      () => undefined,
    );

    await waitUntil(() => authorizeSpy.mock.calls.length === 1);

    const second = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
      idempotencyKey: 'phase2-idem-in-progress-authorize',
      actorId: 'phase2-actor-idem-in-progress',
    }).expect(409);

    expect(second.body.error).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');

    deferred.resolve({
      resultStatus: 'AUTHORIZED',
      providerTransactionId: 'phase2-auth-tx-idem',
      providerRequestId: 'phase2-auth-req-idem',
      raw: {
        providerType: 'POINTS',
      },
    });

    const first = await firstRequest;
    expect(first.body.success).toBe(true);
    expect(first.body.data.leg.status).toBe('AUTHORIZED');
  });
});

async function createPendingIntent(
  context: WalletIntegrationContext,
  referenceId: string,
): Promise<string> {
  const customerId = `${referenceId}-customer`;
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
    idempotencyKey: `phase2-idem-create-${referenceId}`,
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
    idempotencyKey: `phase2-idem-configure-${intentId}`,
    actorId: `phase2-actor-configure-${intentId}`,
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
