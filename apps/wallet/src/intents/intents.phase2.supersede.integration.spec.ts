import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
  paymentAttempts,
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

describeWalletDbIntegration('Intents phase2 supersede integration (real path)', () => {
  let context: WalletIntegrationContext;

  beforeAll(async () => {
    context = await createWalletIntegrationContext();
  });

  afterAll(async () => {
    await cleanupPhase2TestData(context.dbService);
    await closeWalletIntegrationContext(context);
  });

  it('allows only one reference-blocking intent under concurrent creation', async () => {
    const referenceId = phase2ScopedValue('ref-concurrent-single-active');
    const firstIdempotencyKey = phase2ScopedValue('idem-concurrent-a');
    const secondIdempotencyKey = phase2ScopedValue('idem-concurrent-b');

    const firstBody = createSignedCreateIntentBody({
      referenceId,
      customerId: phase2ScopedValue('customer-concurrent-a'),
      payableAmount: 10000,
      snapshotPayload: {
        referenceType: 'STORE_ORDER',
        referenceId,
        currency: 'KRW',
        payableAmount: 10000,
      },
    });
    const secondBody = createSignedCreateIntentBody({
      referenceId,
      customerId: phase2ScopedValue('customer-concurrent-b'),
      payableAmount: 10000,
      snapshotPayload: {
        referenceType: 'STORE_ORDER',
        referenceId,
        currency: 'KRW',
        payableAmount: 10000,
      },
    });

    const [first, second] = await Promise.all([
      sendWriteRequest({
        app: context.app,
        method: 'post',
        path: '/v1/intents',
        body: firstBody,
        idempotencyKey: firstIdempotencyKey,
      }),
      sendWriteRequest({
        app: context.app,
        method: 'post',
        path: '/v1/intents',
        body: secondBody,
        idempotencyKey: secondIdempotencyKey,
      }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const intents = await context.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(eq(paymentIntents.referenceId, referenceId));

    expect(intents).toHaveLength(1);
  });

  it('moves PARTIALLY_CAPTURED intent through SUSPENDED to SUPERSEDED', async () => {
    const intentId = await createPendingIntent(context, 'supersede-success');
    const legs = await configureTwoLegs(context, intentId);

    const firstLegId = legs.find((leg) => leg.sequenceNo === 1)?.id;
    const secondLegId = legs.find((leg) => leg.sequenceNo === 2)?.id;
    expect(firstLegId).toBeDefined();
    expect(secondLegId).toBeDefined();

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${firstLegId as string}/authorize`,
      idempotencyKey: phase2ScopedValue('idem-supersede-authorize-1'),
      actorId: phase2ScopedValue('actor-supersede-authorize-1'),
    }).expect(201);

    await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/legs/${firstLegId as string}/capture`,
      idempotencyKey: phase2ScopedValue('idem-supersede-capture-1'),
      actorId: phase2ScopedValue('actor-supersede-capture-1'),
    }).expect(201);

    const beforeSupersede = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(beforeSupersede[0]?.status).toBe('PARTIALLY_CAPTURED');

    const supersede = await sendWriteRequest({
      app: context.app,
      method: 'post',
      path: `/v1/intents/${intentId}/supersede`,
      idempotencyKey: phase2ScopedValue('idem-supersede-final'),
      actorId: phase2ScopedValue('actor-supersede-final'),
    }).expect(201);

    expect(supersede.body.data.status).toBe('SUPERSEDED');

    const intentRow = await context.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    expect(intentRow[0]?.status).toBe('SUPERSEDED');

    const transitions = await context.dbService.db
      .select({
        newStatus: paymentStateTransitions.newStatus,
      })
      .from(paymentStateTransitions)
      .where(
        and(
          eq(paymentStateTransitions.entityType, 'INTENT'),
          eq(paymentStateTransitions.entityId, intentId),
        ),
      )
      .orderBy(asc(paymentStateTransitions.occurredAt));

    const statusHistory = transitions.map((row) => row.newStatus);
    expect(statusHistory).toContain('SUSPENDED');
    expect(statusHistory).toContain('SUPERSEDED');

    const legRows = await context.dbService.db
      .select({
        id: paymentLegs.id,
        status: paymentLegs.status,
        sequenceNo: paymentLegs.sequenceNo,
      })
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intentId));

    const leg1 = legRows.find((leg) => leg.sequenceNo === 1);
    const leg2 = legRows.find((leg) => leg.sequenceNo === 2);
    expect(leg1?.status).toBe('REFUNDED');
    expect(leg2?.status).toBe('EXPIRED');

    const legIds = legRows.map((leg) => leg.id);
    const compensationAttempts = await context.dbService.db
      .select({
        status: paymentAttempts.status,
      })
      .from(paymentAttempts)
      .where(inArray(paymentAttempts.legId, legIds));

    expect(compensationAttempts.some((attempt) => attempt.status === 'REFUNDED')).toBe(
      true,
    );
  });
});

async function createPendingIntent(
  context: WalletIntegrationContext,
  referenceLabel: string,
): Promise<string> {
  const referenceId = phase2ScopedValue(`ref-${referenceLabel}`);
  const body = createSignedCreateIntentBody({
    referenceId,
    customerId: phase2ScopedValue(`customer-${referenceLabel}`),
    payableAmount: 10000,
    snapshotPayload: {
      referenceType: 'STORE_ORDER',
      referenceId,
      currency: 'KRW',
      payableAmount: 10000,
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

async function configureTwoLegs(
  context: WalletIntegrationContext,
  intentId: string,
): Promise<Array<{ id: string; sequenceNo: number }>> {
  await sendWriteRequest({
    app: context.app,
    method: 'put',
    path: `/v1/intents/${intentId}/legs`,
    idempotencyKey: phase2ScopedValue(`idem-configure-${intentId}`),
    actorId: phase2ScopedValue('actor-configure-two-legs'),
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
  }).expect(200);

  return context.dbService.db
    .select({ id: paymentLegs.id, sequenceNo: paymentLegs.sequenceNo })
    .from(paymentLegs)
    .where(eq(paymentLegs.intentId, intentId));
}
