import { subDays } from 'date-fns';
import { BenefitUsageManager } from './benefit-usage.manager';
import { NO_BENEFIT_USAGE } from './benefit-usage';

describe('BenefitUsageManager.recordUsage', () => {
  const userId = 'user-1';
  const entitlement = { id: 'e1', startsAt: '2026-09-01', endsAt: '2026-10-31', pausedAt: null };
  const contract = { id: 'c1', lastPaymentIntentId: 'pi-1', billingPath: 'PG' };

  function make(opts: {
    active?: boolean;
    withContract?: boolean;
    paidPeriodStart?: Date | null;
    alreadyUsed?: boolean;
    usage?: typeof NO_BENEFIT_USAGE;
    insertedRows?: number;
  }) {
    const returning = jest.fn().mockResolvedValue(Array.from({ length: opts.insertedRows ?? 1 }, () => ({ id: 'u1' })));
    const onConflictDoNothing = jest.fn(() => ({ returning }));
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));
    const resolvePaidPeriodStart = jest.fn().mockResolvedValue(opts.paidPeriodStart ?? null);
    const findMembershipBenefitUsageSince = jest.fn().mockResolvedValue(opts.usage ?? NO_BENEFIT_USAGE);

    const manager = new BenefitUsageManager(
      { db: { insert } } as never,
      { getActiveUserIds: jest.fn().mockResolvedValue(opts.active === false ? [] : [userId]) } as never,
      {
        findCurrentEntitlement: jest.fn().mockResolvedValue(opts.active === false ? null : entitlement),
        findContractWithPlan: jest
          .fn()
          .mockResolvedValue(opts.withContract === false ? null : { contract, plan: { durationDays: 30 } }),
      } as never,
      { resolvePaidPeriodStart } as never,
      {
        hasBenefitUsageSince: jest.fn().mockResolvedValue(opts.alreadyUsed === true),
        findMembershipBenefitUsageSince,
      } as never,
    );
    return { manager, insert, values, findMembershipBenefitUsageSince };
  }

  it('멤버십이 아니면 기록하지 않는다', async () => {
    const { manager, insert } = make({ active: false });
    await expect(manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', true)).resolves.toEqual({ status: 'NOT_MEMBER' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('이번 주기에 이미 기록이 있으면 다시 묻지도 쓰지도 않는다', async () => {
    const { manager, insert, findMembershipBenefitUsageSince } = make({
      paidPeriodStart: subDays(new Date(), 2),
      alreadyUsed: true,
    });
    await expect(manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).resolves.toEqual({ status: 'ALREADY_RECORDED' });
    expect(findMembershipBenefitUsageSince).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('청약철회 창 안이고 다른 혜택도 안 썼으면 동의 없이는 기록하지 않는다', async () => {
    const { manager, insert } = make({ paidPeriodStart: subDays(new Date(), 2) });
    await expect(manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).resolves.toEqual({ status: 'CONFIRMATION_REQUIRED', withdrawalDaysRemaining: 5 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('동의하면 창 안이라도 기록한다 — 키는 해지 화면과 같은 주기 시작', async () => {
    const paidPeriodStart = subDays(new Date(), 2);
    const { manager, values } = make({ paidPeriodStart });
    await expect(manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', true)).resolves.toEqual({ status: 'RECORDED' });
    expect(values).toHaveBeenCalledWith({ userId, kind: 'BEAUTYTOP_PREMIUM', contractId: 'c1', periodStart: paidPeriodStart });
  });

  it('창이 이미 닫혔으면(할인을 썼거나 8일째) 묻지 않고 기록한다', async () => {
    const used = make({
      paidPeriodStart: subDays(new Date(), 2),
      usage: { ...NO_BENEFIT_USAGE, totalDiscountAmount: 1000, orderCount: 1 },
    });
    await expect(used.manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).resolves.toEqual({ status: 'RECORDED' });

    const late = make({ paidPeriodStart: subDays(new Date(), 8) });
    await expect(late.manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).resolves.toEqual({ status: 'RECORDED' });
  });

  it('동시에 두 번 들어와 한쪽이 충돌로 빠지면 ALREADY_RECORDED', async () => {
    const { manager } = make({ paidPeriodStart: subDays(new Date(), 10), insertedRows: 0 });
    await expect(manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).resolves.toEqual({ status: 'ALREADY_RECORDED' });
  });

  it('계약 없는 이용권(관리자 부여)은 철회 창이 없어 묻지 않고, 자격 개시일을 키로 기록한다', async () => {
    const { manager, values, findMembershipBenefitUsageSince } = make({ withContract: false });
    await expect(manager.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).resolves.toEqual({ status: 'RECORDED' });
    expect(findMembershipBenefitUsageSince).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith({
      userId,
      kind: 'BEAUTYTOP_PREMIUM',
      contractId: null,
      periodStart: new Date('2026-09-01'),
    });
  });
});
