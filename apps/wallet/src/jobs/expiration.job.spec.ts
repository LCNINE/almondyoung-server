import { ExpirationJob, EXPIRABLE_INTENT_STATUSES } from './expiration.job';

// ─── Test context ─────────────────────────────────────────────────────────────

type DueIntent = { id: string; userId: string | null; currency: string };

function makeContext(options: { dueIntents?: DueIntent[] } = {}) {
  const dueIntents = options.dueIntents ?? [];

  // Mock the drizzle query chain: select().from().where().limit() → dueIntents
  const limit = jest.fn().mockResolvedValue(dueIntents);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const dbService = { db: { select } };

  const stateTransitionService = {
    transitionIntent: jest.fn().mockResolvedValue(undefined),
  };
  const chargeReleaseService = {
    releaseIntentCharges: jest.fn().mockResolvedValue(undefined),
  };

  const job = new ExpirationJob(
    dbService as never,
    stateTransitionService as never,
    chargeReleaseService as never,
  );

  return { job, dbService, stateTransitionService, chargeReleaseService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExpirationJob', () => {
  it('releases charges (points holds) before cancelling an expired intent', async () => {
    const due: DueIntent = { id: 'intent-exp', userId: 'user-1', currency: 'KRW' };
    const { job, chargeReleaseService, stateTransitionService } = makeContext({
      dueIntents: [due],
    });

    const result = await job.expireDueIntents();

    expect(chargeReleaseService.releaseIntentCharges).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'intent-exp', userId: 'user-1', currency: 'KRW' }),
      expect.any(String),
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-exp',
      'CANCELED',
      expect.anything(),
    );
    expect(result.expired).toBe(1);
  });

  it('정산대기 구독 intent 만료 취소 시 CANCELED payload 에 subscriberRef/Type 을 실어 membership 이 선점을 풀게 한다', async () => {
    // Finding 2: 만료 경로도 취소 이벤트에 subscriber 정보를 실어야 membership 이 billingInProgress 를 해제한다.
    const due = {
      id: 'intent-sub',
      userId: 'user-1',
      currency: 'KRW',
      metadata: { subscriberRef: 'contract-7', subscriberType: 'MEMBERSHIP', purpose: 'SUBSCRIPTION' },
    };
    const { job, stateTransitionService } = makeContext({ dueIntents: [due as never] });

    await job.expireDueIntents();

    const opts = stateTransitionService.transitionIntent.mock.calls[0][2];
    expect(opts.outboxEvent.payload).toMatchObject({ subscriberRef: 'contract-7', subscriberType: 'MEMBERSHIP' });
  });
});

describe('ExpirationJob — expirable statuses', () => {
  it('includes AWAITING_DEPOSIT so unpaid bank-transfer intents get released + canceled at the deposit window', () => {
    expect(EXPIRABLE_INTENT_STATUSES).toContain('AWAITING_DEPOSIT');
  });

  it('still includes the in-flight statuses', () => {
    expect(EXPIRABLE_INTENT_STATUSES).toEqual(
      expect.arrayContaining(['CREATED', 'PROCESSING', 'REQUIRES_ACTION', 'AWAITING_DEPOSIT']),
    );
  });
});
