import { eq } from 'drizzle-orm';
import * as request from 'supertest';
import { paymentIntents, paymentLegs } from '../schema';
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

describeWalletDbIntegration('Intents phase2 core integration (real path)', () => {
  let context: WalletIntegrationContext;

  beforeAll(async () => {
    context = await createWalletIntegrationContext();
  });

  beforeEach(async () => {
    await cleanupPhase2TestData(context.dbService);
  });

  afterAll(async () => {
    await cleanupPhase2TestData(context.dbService);
    await closeWalletIntegrationContext(context);
  });

  it('creates and reads payment intent over HTTP with real DB/service path', async () => {
    const body = createSignedCreateIntentBody();

    const created = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey: 'phase2-idem-core-create-1',
    }).expect(201);

    expect(created.body.success).toBe(true);
    expect(created.body.data.status).toBe('PENDING');
    expect(created.body.data.referenceId).toBe(body.referenceId);

    const fetched = await request(context.app.getHttpServer())
      .get(`/v1/intents/${created.body.data.id}`)
      .expect(200);

    expect(fetched.body.success).toBe(true);
    expect(fetched.body.data.id).toBe(created.body.data.id);
    expect(fetched.body.data.referenceId).toBe(body.referenceId);
  });

  it('rejects unsupported referenceType input', async () => {
    const body = createSignedCreateIntentBody({
      referenceType: 'NOT_ALLOWED_REFERENCE_TYPE',
    });

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey: 'phase2-idem-core-invalid-ref-type',
    }).expect(400);
  });

  it('rejects expired signature before intent row is created', async () => {
    const body = createSignedCreateIntentBody({
      signedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey: 'phase2-idem-core-expired-signature',
    }).expect(400);

    expect(response.body.error).toBe('SIGNATURE_EXPIRED');

    const rows = await context.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(eq(paymentIntents.referenceId, body.referenceId as string))
      .limit(1);

    expect(rows).toHaveLength(0);
  });

  it('rejects tampered signature before intent row is created', async () => {
    const body = createSignedCreateIntentBody();
    body.signature = `${body.signature as string}x`;

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey: 'phase2-idem-core-invalid-signature',
    }).expect(400);

    expect(response.body.error).toBe('INVALID_SIGNATURE');

    const rows = await context.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(eq(paymentIntents.referenceId, body.referenceId as string))
      .limit(1);

    expect(rows).toHaveLength(0);
  });

  it('applies zero-amount fast path with no leg creation', async () => {
    const body = createSignedCreateIntentBody({
      payableAmount: 0,
      snapshotPayload: {
        referenceType: 'STORE_ORDER',
        referenceId: 'phase2-fastpath-ref',
        currency: 'KRW',
        payableAmount: 0,
      },
    });

    const response = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body,
      idempotencyKey: 'phase2-idem-core-fast-path',
    }).expect(201);

    expect(response.body.data.status).toBe('SUCCEEDED');

    const legs = await context.dbService.db
      .select({ id: paymentLegs.id })
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, response.body.data.id))
      .limit(1);

    expect(legs).toHaveLength(0);
  });

  it('rejects creating new intent when same reference is already SUCCEEDED', async () => {
    const referenceId = 'phase2-already-paid-reference';
    const customerId = 'phase2-customer-already-paid';

    const firstBody = createSignedCreateIntentBody({
      referenceId,
      customerId,
      payableAmount: 0,
      snapshotPayload: {
        referenceType: 'STORE_ORDER',
        referenceId,
        currency: 'KRW',
        payableAmount: 0,
      },
    });

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body: firstBody,
      idempotencyKey: 'phase2-idem-core-already-paid-first',
    }).expect(201);

    const secondBody = createSignedCreateIntentBody({
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

    const second = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: '/v1/intents',
      body: secondBody,
      idempotencyKey: 'phase2-idem-core-already-paid-second',
    }).expect(409);

    expect(second.body.error).toBe('REFERENCE_ALREADY_PAID');
  });
});
