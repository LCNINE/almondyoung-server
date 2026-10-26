import { SubscriptionManager } from './subscription.manager';
import { SubscriptionCancellationManager } from './subscription-cancellation.manager';
import * as schema from '../../shared/schemas/entities/schema';
import { BadRequestException } from '../../shared/exceptions/subscription.exceptions';

/** 잠금 select 가 돌려줄 행과 호출 순서를 기록하는 tx 목 */
function makeTx(lockedRow: { status: string; cancelledAt?: Date | null }, order: string[], lockModes: string[] = []) {
  const chain = (rows: unknown[]) => {
    const c: Record<string, jest.Mock> = {};
    c.from = jest.fn(() => c);
    c.where = jest.fn(() => c);
    c.for = jest.fn((mode: string) => {
      lockModes.push(mode);
      return c;
    });
    c.limit = jest.fn(async () => rows);
    c.returning = jest.fn(async () => rows);
    c.values = jest.fn(() => c);
    c.set = jest.fn(() => c);
    return c;
  };
  const updates: unknown[] = [];
  const tx = {
    select: jest.fn(() => chain([lockedRow])),
    insert: jest.fn(() => chain([{ id: 'batch-1' }])),
    update: jest.fn((table: unknown) => {
      updates.push(table);
      if (table === schema.subscriptionEntitlement) order.push('terminate');
      const c = chain([]);
      c.where = jest.fn(async () => undefined);
      return c;
    }),
    delete: jest.fn(() => ({ where: jest.fn(async () => undefined) })),
  };
  return { tx, updates };
}

// 계약 행 전체가 아니라 종료 경로가 읽는 필드만 필요해 never 로 좁힌다(테스트 한정)
const contract = { id: 'c1', userId: 'u1', billingDate: '2026-11-01' } as never;

describe('계약 종료 경로 — 잠금 재확인과 임시 이용권 복구', () => {
  const order: string[] = [];
  const entitlementManager = {
    terminateActiveEntitlement: jest.fn(async () => {
      order.push('terminate');
    }),
    restoreTakenOverGrant: jest.fn(async () => {
      order.push('restore');
      return 0;
    }),
  };
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue({ id: 'ev1' }) };

  const makeDb = (tx: unknown) => ({ db: { transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) } });

  beforeEach(() => {
    order.length = 0;
    jest.clearAllMocks();
  });

  it('voidSubscription: 계약이 이미 CANCELLED 면 entitlement 를 건드리지 않고 기존 cancelledAt 으로 반환한다', async () => {
    const cancelledAt = new Date('2026-10-01T00:00:00Z');
    const { tx, updates } = makeTx({ status: 'CANCELLED', cancelledAt }, order);
    const manager = new SubscriptionManager(
      makeDb(tx) as never,
      contractEventManager as never,
      entitlementManager as never,
    );

    const result = await manager.voidSubscription('u1', contract);

    expect(result).toEqual({ cancelledAt, contractId: 'c1' });
    expect(updates).not.toContain(schema.subscriptionEntitlement);
    expect(entitlementManager.terminateActiveEntitlement).not.toHaveBeenCalled();
    expect(entitlementManager.restoreTakenOverGrant).not.toHaveBeenCalled();
  });

  it('voidSubscription: ACTIVE 면 종료 후 restoreTakenOverGrant(tx, contract) 를 부른다', async () => {
    const lockModes: string[] = [];
    const { tx } = makeTx({ status: 'ACTIVE' }, order, lockModes);
    const manager = new SubscriptionManager(
      makeDb(tx) as never,
      contractEventManager as never,
      entitlementManager as never,
    );

    await manager.voidSubscription('u1', contract);

    expect(lockModes).toEqual(['no key update']);
    expect(order).toEqual(['terminate', 'restore']);
    expect(entitlementManager.restoreTakenOverGrant).toHaveBeenCalledWith(tx, contract);
  });

  const eligibility = { eligible: false, reason: '', amount: 0 };
  const plan = { id: 'p1', price: 1000 } as never;

  function makeCancellation(tx: unknown) {
    return new SubscriptionCancellationManager(
      makeDb(tx) as never,
      contractEventManager as never,
      entitlementManager as never,
    );
  }

  it('cancelImmediately: 이미 CANCELLED 면 BadRequestException(이미 해지된 구독입니다) 을 던진다', async () => {
    const { tx } = makeTx({ status: 'CANCELLED' }, order);
    const manager = makeCancellation(tx);

    const promise = manager.cancelImmediately('u1', contract, plan, 'R', undefined, eligibility);

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow('이미 해지된 구독입니다');
    expect(entitlementManager.restoreTakenOverGrant).not.toHaveBeenCalled();
  });

  it('forceCancelSubscription: 이미 CANCELLED 면 BadRequestException 을 던지고 복구하지 않는다', async () => {
    const lockModes: string[] = [];
    const { tx } = makeTx({ status: 'CANCELLED' }, order, lockModes);

    await expect(
      makeCancellation(tx).forceCancelSubscription(contract, plan, 'admin1', 'r', 'NONE'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lockModes).toEqual(['no key update']);
    expect(entitlementManager.restoreTakenOverGrant).not.toHaveBeenCalled();
  });

  it('cancelImmediately: 종료 후 restoreTakenOverGrant 를 같은 tx 로 부른다', async () => {
    const { tx } = makeTx({ status: 'ACTIVE' }, order);

    await makeCancellation(tx).cancelImmediately('u1', contract, plan, 'R', undefined, eligibility);

    expect(order).toEqual(['terminate', 'restore']);
    expect(entitlementManager.restoreTakenOverGrant).toHaveBeenCalledWith(tx, contract);
  });

  it('forceCancelSubscription: 종료 후 restoreTakenOverGrant 를 같은 tx 로 부른다', async () => {
    const { tx } = makeTx({ status: 'ACTIVE' }, order);

    await makeCancellation(tx).forceCancelSubscription(contract, plan, 'admin1', 'r', 'NONE');

    expect(order).toEqual(['terminate', 'restore']);
    expect(entitlementManager.restoreTakenOverGrant).toHaveBeenCalledWith(tx, contract);
  });
});
