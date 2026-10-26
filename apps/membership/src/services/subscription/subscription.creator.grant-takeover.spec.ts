import { addDays } from 'date-fns';
import { SubscriptionCreator } from './subscription.creator';
import * as schema from '../../shared/schemas/entities/schema';
import { ActiveSubscriptionExistsException } from '../../shared/exceptions/subscription.exceptions';

describe('SubscriptionCreator — 관리자 임시 지급 이어받기', () => {
  function makeCreator(
    options: {
      trialDays?: number;
      entitlementError?: unknown;
      currentEntitlement?: boolean;
      grantStatus?: string;
    } = {},
  ) {
    const insertedContracts: Record<string, unknown>[] = [];
    const updates: { table: unknown; set: Record<string, unknown> }[] = [];
    const execute = jest.fn().mockResolvedValue(undefined);
    const rowsFor = (table: unknown) => {
      if (table === schema.subscriptionEntitlement) return options.currentEntitlement ? [{ id: 'other' }] : [];
      if (table === schema.subscriptionContracts) return [{ status: options.grantStatus ?? 'ACTIVE' }];
      return [];
    };
    const tx = {
      execute,
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({ limit: () => Promise.resolve(rowsFor(table)) }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === schema.subscriptionContracts) insertedContracts.push(v);
          return { returning: () => Promise.resolve([{ id: 'new-contract', ...v }]) };
        },
      }),
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return { where: () => Promise.resolve() };
        },
      }),
    };
    // 처음 가입하는 사람으로 본다(체험 적용 조건).
    const db = {
      transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: () => Promise.resolve([]) }),
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    };
    const addEvent = jest.fn().mockResolvedValue(undefined);
    const createEntitlement = options.entitlementError
      ? jest.fn().mockRejectedValue(options.entitlementError)
      : jest.fn().mockResolvedValue({ id: 'e1' });
    const creator = new SubscriptionCreator(
      { db } as never,
      { addEvent } as never,
      { createEntitlement } as never,
      { getBooleanPolicy: jest.fn().mockResolvedValue(true) } as never,
      { saveStatusChanged: jest.fn() } as never,
    );
    const plan = { id: 'p1', tierId: 't1', durationDays: 30, trialDays: options.trialDays ?? 0 } as never;
    return { creator, plan, insertedContracts, updates, addEvent, execute };
  }

  const tier = { id: 't1' } as never;
  const daysFromToday = (n: number) => addDays(new Date(), n).toISOString().split('T')[0];
  const create = (creator: SubscriptionCreator, plan: never, remainingDays: number) =>
    creator.createNewSubscription('u1', plan, tier, {}, 'recurring', false, 'INVOICE', '', {
      grantContractId: 'grant-contract',
      remainingDays,
    });

  it('남은 지급 일수만큼 첫 청구일을 미룬다', async () => {
    const { creator, plan, insertedContracts } = makeCreator({ trialDays: 0 });
    await create(creator, plan, 5);
    expect(insertedContracts[0].billingDate).toBe(daysFromToday(5));
  });

  it('체험이 더 길면 체험 기준이다 — 합산하지 않는다', async () => {
    const { creator, plan, insertedContracts } = makeCreator({ trialDays: 7 });
    await create(creator, plan, 2);
    expect(insertedContracts[0].billingDate).toBe(daysFromToday(7));
  });

  it('지급 계약을 닫고 이어받은 사실을 남긴다', async () => {
    const { creator, plan, updates, addEvent } = makeCreator();
    await create(creator, plan, 3);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(schema.subscriptionContracts);
    expect(updates[0].set).toMatchObject({ status: 'CANCELLED', cancellationReasonCode: 'SUPERSEDED_BY_SUBSCRIPTION' });
    expect(addEvent).toHaveBeenCalledWith(
      expect.anything(),
      'grant-contract',
      'SUPERSEDED_BY_SUBSCRIPTION',
      { newContractId: 'new-contract', remainingDays: 3 },
      'USER',
      'u1',
      expect.anything(),
      'u1',
    );
  });

  it('현재 이용권 유니크에 막히면 이미 가입됨으로 바꾼다 — drizzle 이 감싼 에러도 본다', async () => {
    const pgError = { code: '23505', constraint_name: 'uq_subscription_entitlement_current_user' };
    const { creator, plan } = makeCreator({
      entitlementError: Object.assign(new Error('wrapped'), { cause: pgError }),
    });
    await expect(
      creator.createNewSubscription('u1', plan, tier, {}, 'recurring', false, 'INVOICE'),
    ).rejects.toBeInstanceOf(ActiveSubscriptionExistsException);
  });

  it('트랜잭션 안에서 다른 가입이 먼저 만든 이용권을 보면 덮어쓰지 않고 거절한다', async () => {
    const { creator, plan, insertedContracts } = makeCreator({ currentEntitlement: true });
    await expect(
      creator.createNewSubscription('u1', plan, tier, {}, 'recurring', false, 'INVOICE'),
    ).rejects.toBeInstanceOf(ActiveSubscriptionExistsException);
    expect(insertedContracts).toHaveLength(0);
  });

  it('같은 사용자의 가입을 트랜잭션 잠금으로 한 줄로 세운다', async () => {
    const { creator, plan, execute } = makeCreator();
    await creator.createNewSubscription('u1', plan, tier, {}, 'recurring', false, 'INVOICE');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('다른 가입이 먼저 지급분을 이어받았으면 덮어쓰지 않고 거절한다', async () => {
    const { creator, plan, insertedContracts } = makeCreator({ grantStatus: 'CANCELLED' });
    await expect(create(creator, plan, 3)).rejects.toBeInstanceOf(ActiveSubscriptionExistsException);
    expect(insertedContracts).toHaveLength(0);
  });
});
