import { ExpirationJob } from './expiration.job';

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
});
