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
      durationDays?: number;
      currentSequence?: boolean[];
    } = {},
  ) {
    const insertedContracts: Record<string, unknown>[] = [];
    const updates: { table: unknown; set: Record<string, unknown> }[] = [];
    const trace: string[] = [];
    const execute = jest.fn(async () => {
      trace.push('lock');
    });
    let currentReads = 0;
    const rowsFor = (table: unknown, selection: Record<string, unknown>) => {
      if (table === schema.subscriptionEntitlement) {
        const present = options.currentSequence
          ? (options.currentSequence[currentReads++] ?? false)
          : options.currentEntitlement;
        return present ? [{ id: 'other' }] : [];
      }
      // 가입 이력 조회는 id 만 고른다 — 이력이 없는 첫 가입자로 본다
      if (table === schema.subscriptionContracts && 'status' in selection)
        return [{ status: options.grantStatus ?? 'ACTIVE' }];
      return [];
    };
    const tx = {
      execute,
      select: (selection: Record<string, unknown>) => (
        trace.push('select'),
        {
          from: (table: unknown) => ({
            where: () => ({ limit: () => Promise.resolve(rowsFor(table, selection)) }),
          }),
        }
      ),
      insert: (table: unknown) => (
        trace.push('insert'),
        {
          values: (v: Record<string, unknown>) => {
            if (table === schema.subscriptionContracts) insertedContracts.push(v);
            return { returning: () => Promise.resolve([{ id: 'new-contract', ...v }]) };
          },
        }
      ),
      update: (table: unknown) => (
        trace.push('update'),
        {
          set: (set: Record<string, unknown>) => {
            updates.push({ table, set });
            return { where: () => Promise.resolve() };
          },
        }
      ),
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
    const plan = {
      id: 'p1',
      tierId: 't1',
      durationDays: options.durationDays ?? 30,
      trialDays: options.trialDays ?? 0,
    } as never;
    return { creator, plan, insertedContracts, updates, addEvent, execute, createEntitlement, trace };
  }

  const tier = { id: 't1' } as never;
  const daysFromToday = (n: number) => addDays(new Date(), n).toISOString().split('T')[0];
  const create = (creator: SubscriptionCreator, plan: never, remainingDays: number) =>
    creator.createNewSubscription('u1', plan, tier, {}, 'recurring', false, 'INVOICE', '', {
      grantContractId: 'grant-contract',
      grantEndsAt: daysFromToday(remainingDays),
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
    const { creator, plan, execute, trace } = makeCreator();
    await creator.createNewSubscription('u1', plan, tier, {}, 'recurring', false, 'INVOICE');
    expect(execute).toHaveBeenCalledTimes(1);
    // 잠금이 첫 문장이고 이후의 읽기·쓰기는 모두 그 뒤다
    expect(trace[0]).toBe('lock');
    expect(trace.filter((t) => t === 'lock')).toHaveLength(1);
    expect(JSON.stringify(execute.mock.calls[0])).toContain('u1');
  });

  it('다른 가입이 먼저 지급분을 이어받았으면 덮어쓰지 않고 거절한다', async () => {
    const { creator, plan, insertedContracts } = makeCreator({ grantStatus: 'CANCELLED' });
    await expect(create(creator, plan, 3)).rejects.toBeInstanceOf(ActiveSubscriptionExistsException);
    expect(insertedContracts).toHaveLength(0);
  });

  describe('UTC 자정 직후 가입', () => {
    afterEach(() => jest.useRealTimers());

    it('종료일 기준으로 센다 — 청구일이 하루 밀리지 않는다', async () => {
      jest.useFakeTimers({
        now: new Date('2026-10-27T00:00:01Z'),
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout'],
      });
      const { creator, plan, insertedContracts } = makeCreator();
      await creator.createNewSubscription('u1', plan, tier, {}, 'recurring', false, 'INVOICE', '', {
        grantContractId: 'grant-contract',
        grantEndsAt: '2026-11-15',
      });
      expect(insertedContracts[0].billingDate).toBe('2026-11-15');
    });

    it('one_time 종료일은 지급 종료일 + 플랜 일수', async () => {
      jest.useFakeTimers({
        now: new Date('2026-10-27T00:00:01Z'),
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout'],
      });
      const { creator, plan, insertedContracts, createEntitlement } = makeCreator({ durationDays: 365 });
      await creator.createNewSubscription('u1', plan, tier, {}, 'one_time', false, 'CHARGE', '', {
        grantContractId: 'grant-contract',
        grantEndsAt: '2026-11-15',
      });
      expect(insertedContracts[0].billingDate).toBe('2026-11-15');
      expect((createEntitlement.mock.calls[0][4] as Date).toISOString().split('T')[0]).toBe(
        addDays(new Date('2026-11-15T00:00:00Z'), 365).toISOString().split('T')[0],
      );
    });
  });

  describe('일시결제', () => {
    const entitlementEndsAt = (createEntitlement: jest.Mock) =>
      (createEntitlement.mock.calls[0][4] as Date).toISOString().split('T')[0];

    it('one_time 이어받기는 종료일이 오늘 + 남은 일수 + 플랜 일수', async () => {
      const { creator, plan, insertedContracts, createEntitlement } = makeCreator({ durationDays: 365 });
      await creator.createNewSubscription('u1', plan, tier, {}, 'one_time', false, 'CHARGE', '', {
        grantContractId: 'grant-contract',
        grantEndsAt: daysFromToday(20),
      });
      expect(entitlementEndsAt(createEntitlement)).toBe(daysFromToday(385));
      expect(insertedContracts[0].billingDate).toBe(daysFromToday(20));
    });

    it('EXPIRED 지급 계약이면 남은 일수 0으로 가입을 만든다', async () => {
      const { creator, plan, insertedContracts, createEntitlement, updates } = makeCreator({
        durationDays: 365,
        grantStatus: 'EXPIRED',
      });
      await creator.createNewSubscription('u1', plan, tier, {}, 'one_time', false, 'CHARGE', '', {
        grantContractId: 'grant-contract',
        grantEndsAt: daysFromToday(20),
      });
      expect(entitlementEndsAt(createEntitlement)).toBe(daysFromToday(365));
      expect(insertedContracts[0].billingDate).toBe(daysFromToday(0));
      expect(updates).toHaveLength(0);
    });

    it('EXPIRED 지급 계약인데 다른 current 이용권이 있으면 ActiveSubscriptionExistsException', async () => {
      const { creator, plan, insertedContracts } = makeCreator({ grantStatus: 'EXPIRED', currentEntitlement: true });
      await expect(
        creator.createNewSubscription('u1', plan, tier, {}, 'one_time', false, 'CHARGE', '', {
          grantContractId: 'grant-contract',
          grantEndsAt: daysFromToday(20),
        }),
      ).rejects.toBeInstanceOf(ActiveSubscriptionExistsException);
      expect(insertedContracts).toHaveLength(0);
    });

    it('EXPIRED 를 본 뒤 다시 읽은 current 가 비어 있으면(만료 커밋 직전에 읽은 것) 가입을 만든다', async () => {
      const { creator, plan, createEntitlement } = makeCreator({
        durationDays: 365,
        grantStatus: 'EXPIRED',
        currentSequence: [true, false],
      });
      await creator.createNewSubscription('u1', plan, tier, {}, 'one_time', false, 'CHARGE', '', {
        grantContractId: 'grant-contract',
        grantEndsAt: daysFromToday(20),
      });
      expect(entitlementEndsAt(createEntitlement)).toBe(daysFromToday(365));
    });

    it('CANCELLED 지급 계약이면 ActiveSubscriptionExistsException', async () => {
      const { creator, plan, insertedContracts } = makeCreator({ grantStatus: 'CANCELLED' });
      await expect(
        creator.createNewSubscription('u1', plan, tier, {}, 'one_time', false, 'CHARGE', '', {
          grantContractId: 'grant-contract',
          grantEndsAt: daysFromToday(20),
        }),
      ).rejects.toBeInstanceOf(ActiveSubscriptionExistsException);
      expect(insertedContracts).toHaveLength(0);
    });

    it('one_time 이어받기 없으면 종료일은 오늘 + 플랜 일수 (기존)', async () => {
      const { creator, plan, insertedContracts, createEntitlement } = makeCreator({ durationDays: 365 });
      await creator.createNewSubscription('u1', plan, tier, {}, 'one_time', false, 'CHARGE', '');
      expect(entitlementEndsAt(createEntitlement)).toBe(daysFromToday(365));
      expect(insertedContracts[0].billingDate).toBe(daysFromToday(0));
    });
  });
});
