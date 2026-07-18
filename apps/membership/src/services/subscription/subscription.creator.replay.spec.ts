import { SubscriptionCreator } from './subscription.creator';
import * as schema from '../../shared/schemas/entities/schema';

/**
 * 같은 payment intent 로 새 계약을 재발급하는 replay 차단 검증.
 * - 선조회: lastPaymentIntentId 가 같은 기존 계약이 있으면 거부 (레거시 데이터 커버)
 * - 유니크 인덱스(uq_billing_events_intent_event) 충돌(23505)은 도메인 예외로 변환 (동시 요청 레이스 커버)
 */
describe('SubscriptionCreator — payment intent replay 차단', () => {
  function makeCreator(options: { existingContractByIntent?: boolean; billingEventInsertError?: Error }) {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(options.existingContractByIntent ? [{ id: 'old-contract' }] : []),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === schema.billingEvents && options.billingEventInsertError) {
            throw options.billingEventInsertError;
          }
          return { returning: () => Promise.resolve([{ id: 'row1', ...v }]) };
        },
      }),
    };
    const dbService = { db: { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } };
    const contractEventManager = { addEvent: jest.fn().mockResolvedValue(undefined) };
    const entitlementManager = { createEntitlement: jest.fn().mockResolvedValue({ id: 'e1' }) };
    const policyService = { getBooleanPolicy: jest.fn().mockResolvedValue(true) };

    return new SubscriptionCreator(
      dbService as never,
      contractEventManager as never,
      entitlementManager as never,
      policyService as never,
    );
  }

  const plan = { id: 'p1', tierId: 't1', durationDays: 30, trialDays: 0 } as never;
  const tier = { id: 't1' } as never;
  const paymentRefs = { initialPaymentIntentId: 'intent-1', initialPaymentAmount: 10000 };

  it('같은 intent 로 만든 기존 계약이 있으면 거부', async () => {
    const creator = makeCreator({ existingContractByIntent: true });
    await expect(creator.createNewSubscription('u1', plan, tier, paymentRefs, 'one_time')).rejects.toMatchObject({
      code: 'PAYMENT_INTENT_ALREADY_USED',
    });
  });

  it('billing_events 유니크 충돌(23505) → PAYMENT_INTENT_ALREADY_USED 로 변환', async () => {
    const creator = makeCreator({
      billingEventInsertError: Object.assign(new Error('duplicate key'), { code: '23505' }),
    });
    await expect(creator.createNewSubscription('u1', plan, tier, paymentRefs, 'one_time')).rejects.toMatchObject({
      code: 'PAYMENT_INTENT_ALREADY_USED',
    });
  });

  it('충돌 없는 정상 생성은 통과하고 intentId 가 billing event 에 기록된다', async () => {
    const insertedBillingEvents: Record<string, unknown>[] = [];
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === schema.billingEvents) insertedBillingEvents.push(v);
          return { returning: () => Promise.resolve([{ id: 'row1' }]) };
        },
      }),
    };
    const creator = new SubscriptionCreator(
      { db: { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } } as never,
      { addEvent: jest.fn().mockResolvedValue(undefined) } as never,
      { createEntitlement: jest.fn().mockResolvedValue({ id: 'e1' }) } as never,
      { getBooleanPolicy: jest.fn().mockResolvedValue(true) } as never,
    );

    const result = await creator.createNewSubscription('u1', plan, tier, paymentRefs, 'one_time');
    expect(result.contractId).toBe('row1');
    expect(insertedBillingEvents).toHaveLength(1);
    expect(insertedBillingEvents[0]).toMatchObject({ eventType: 'CHARGE_SUCCESS', paymentIntentId: 'intent-1' });
  });
});
