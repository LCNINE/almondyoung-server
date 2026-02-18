import { eq } from 'drizzle-orm';
import { ProviderOperationResult } from '../providers/payment-provider.types';
import {
  WalletIntegrationContext,
  cleanupPhase2TestData,
  closeWalletIntegrationContext,
  createSignedCreateIntentBody,
  createWalletIntegrationContext,
  describeWalletDbIntegration,
  sendWriteRequest,
} from './test-helpers/wallet-test-app';

jest.setTimeout(60_000);

describeWalletDbIntegration('Intents phase2 legs integration (real path)', () => {
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

  it('rejects leg amount <= 0 input', async () => {
    const intentId = await createPendingIntent(context, 'phase2-legs-invalid-amount');

    await sendWriteRequest({
      app: context.app,
      method: 'put',
      path: `/v1/intents/${intentId}/legs`,
      idempotencyKey: 'phase2-idem-legs-invalid-amount',
      actorId: 'phase2-actor-legs-invalid-amount',
      body: {
        legs: [
          {
            providerType: 'POINTS',
            amount: 0,
            sequenceNo: 1,
            isRequired: true,
          },
        ],
      },
    }).expect(400);
  });

  it('authorizes and captures POINTS leg successfully', async () => {
    const intentId = await createPendingIntent(context, 'phase2-legs-capture-success');
    const [leg] = await configureSinglePointsLeg(context, intentId, 10000);

    const authorize = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
      idempotencyKey: 'phase2-idem-legs-authorize-success',
      actorId: 'phase2-actor-legs-authorize-success',
    }).expect(201);

    expect(authorize.body.data.leg.status).toBe('AUTHORIZED');
    expect(authorize.body.data.attempt.status).toBe('AUTHORIZED');

    const capture = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/capture`,
      idempotencyKey: 'phase2-idem-legs-capture-success',
      actorId: 'phase2-actor-legs-capture-success',
    }).expect(201);

    expect(capture.body.data.leg.status).toBe('CAPTURED');
    expect(capture.body.data.intent.status).toBe('SUCCEEDED');
    expect(capture.body.data.attempt.status).toBe('CAPTURED');
  });

  it('returns capability error when AUTHORIZE support is disabled at runtime', async () => {
    const supportsSpy = jest
      .spyOn(context.pointsProvider, 'supports')
      .mockImplementation((operation) => operation !== 'AUTHORIZE');

    const intentId = await createPendingIntent(
      context,
      'phase2-legs-capability-not-supported',
    );

    const response = await sendWriteRequest({
      app: context.app,
      method: 'put',
      path: `/v1/intents/${intentId}/legs`,
      idempotencyKey: 'phase2-idem-legs-capability-not-supported',
      actorId: 'phase2-actor-legs-capability-not-supported',
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
    }).expect(400);

    expect(response.body.error).toBe('PROVIDER_CAPABILITY_NOT_SUPPORTED');
    expect(supportsSpy).toHaveBeenCalled();
  });

  it('moves leg to REQUIRES_CUSTOMER_ACTION when provider asks customer action', async () => {
    const authorizeSpy = jest
      .spyOn(context.pointsProvider, 'authorize')
      .mockResolvedValueOnce({
        resultStatus: 'REQUIRES_CUSTOMER_ACTION',
        providerTransactionId: 'phase2-provider-action-1',
        nextAction: {
          type: 'REDIRECT',
          url: 'https://example.test/redirect',
        },
      } satisfies ProviderOperationResult);

    const intentId = await createPendingIntent(context, 'phase2-legs-customer-action');
    const [leg] = await configureSinglePointsLeg(context, intentId, 10000);

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
      idempotencyKey: 'phase2-idem-legs-customer-action',
      actorId: 'phase2-actor-legs-customer-action',
    }).expect(201);

    expect(authorizeSpy).toHaveBeenCalledTimes(1);
    expect(response.body.data.leg.status).toBe('REQUIRES_CUSTOMER_ACTION');
    expect(response.body.data.attempt.status).toBe('REQUIRES_ACTION');
  });

  it('moves leg to REQUIRES_ADMIN_CONFIRMATION when provider asks admin confirmation', async () => {
    const authorizeSpy = jest
      .spyOn(context.pointsProvider, 'authorize')
      .mockResolvedValueOnce({
        resultStatus: 'REQUIRES_ADMIN_CONFIRMATION',
        providerTransactionId: 'phase2-provider-admin-1',
      } satisfies ProviderOperationResult);

    const intentId = await createPendingIntent(
      context,
      'phase2-legs-admin-confirmation',
    );
    const [leg] = await configureSinglePointsLeg(context, intentId, 10000);

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${leg.id}/authorize`,
      idempotencyKey: 'phase2-idem-legs-admin-confirmation',
      actorId: 'phase2-actor-legs-admin-confirmation',
    }).expect(201);

    expect(authorizeSpy).toHaveBeenCalledTimes(1);
    expect(response.body.data.leg.status).toBe('REQUIRES_ADMIN_CONFIRMATION');
    expect(response.body.data.attempt.status).toBe('REQUIRES_ACTION');
  });
});

async function createPendingIntent(
  context: WalletIntegrationContext,
  referenceIdSuffix: string,
): Promise<string> {
  const referenceId = `phase2-ref-${referenceIdSuffix}`;
  const customerId = `phase2-customer-${referenceIdSuffix}`;
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
    idempotencyKey: `phase2-idem-create-${referenceIdSuffix}`,
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
    idempotencyKey: `phase2-idem-configure-${intentId}`,
    actorId: `phase2-actor-configure-${intentId}`,
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
  }).expect(200);

  const rows = await context.dbService.db
    .select({ id: paymentLegs.id })
    .from(paymentLegs)
    .where(eq(paymentLegs.intentId, intentId));

  return rows;
}
