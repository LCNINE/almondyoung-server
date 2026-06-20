import { TossActionExpirationJob } from './toss-action-expiration.job';

// ─── Test context ─────────────────────────────────────────────────────────────

function makeContext(options: { dueIntents?: { id: string }[] } = {}) {
  const dueIntents = options.dueIntents ?? [];

  // Mock the drizzle query chain: select().from().where().limit() → dueIntents
  const limit = jest.fn().mockResolvedValue(dueIntents);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const dbService = { db: { select } };

  const abandonService = {
    abandon: jest.fn().mockResolvedValue({ status: 'CREATED' }),
  };

  const job = new TossActionExpirationJob(dbService as never, abandonService as never);

  return { job, abandonService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TossActionExpirationJob', () => {
  it('reclaims a timed-out REQUIRES_ACTION intent by abandoning it (soft reset)', async () => {
    const { job, abandonService } = makeContext({ dueIntents: [{ id: 'intent-exp' }] });

    const result = await job.expireDueActions();

    expect(abandonService.abandon).toHaveBeenCalledWith('intent-exp', expect.any(String));
    expect(result.reclaimed).toBe(1);
  });
});
