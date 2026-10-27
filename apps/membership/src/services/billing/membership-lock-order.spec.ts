import { BillingOutcomeHandler } from './billing-outcome.handler';
import { InvoiceOutcomeHandler } from './invoice-outcome.handler';
import { PauseManager } from '../pause/pause.manager';
import { SubscriptionManager } from '../subscription/subscription.manager';

// 첫 문장이 회원 잠금인지 본다. 이 뒤의 문장은 목이 비어 있어 어떻게 끝나도 상관없다.
function makeTrackedTx() {
  const trace: string[] = [];
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => {
        if (prop === 'then') return (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res);
        return chain();
      },
      apply: () => chain(),
    });
  const tx = {
    execute: jest.fn(async () => {
      trace.push('lock');
    }),
    select: jest.fn(() => (trace.push('select'), chain())),
    insert: jest.fn(() => (trace.push('insert'), chain())),
    update: jest.fn(() => (trace.push('update'), chain())),
    delete: jest.fn(() => (trace.push('delete'), chain())),
  };
  return { tx, trace };
}

describe('회원 잠금이 첫 문장인 트랜잭션', () => {
  const cases: [string, (tx: unknown) => Promise<unknown>][] = [
    ['handleSuccess', (tx) => makeBilling(tx).handleSuccess('c1', 1000, 'pi1')],
    ['handleFailure', (tx) => makeBilling(tx).handleFailure('c1', 'E', null, 'pi1')],
    ['handleCanceled', (tx) => makeBilling(tx).handleCanceled('c1', 'pi1')],
    ['invoice handlePaid', (tx) => makeInvoice(tx).handlePaid('c1', 'inv1', '2026-12-01', 1000)],
    ['invoice handlePaymentFailed', (tx) => makeInvoice(tx).handlePaymentFailed('c1', 'inv1', null, 1, 'E', null)],
    ['pause resumePause', (tx) => makePause(tx).resumePause('u1', { id: 'e1' })],
    [
      'upgradeSubscription',
      (tx) =>
        makeSub(tx).upgradeSubscription(
          'u1',
          { id: 'c1' } as never,
          't1',
          { durationDays: 30 } as never,
          { priorityLevel: 2 } as never,
          1,
        ),
    ],
    [
      'downgradeSubscription',
      (tx) =>
        makeSub(tx).downgradeSubscription(
          'u1',
          { id: 'c1' } as never,
          { durationDays: 30 } as never,
          { priorityLevel: 1 } as never,
          2,
        ),
    ],
    ['invoice handleVoided', (tx) => makeInvoice(tx).handleVoided('c1', 'inv1', null)],
  ];

  const db = (tx: unknown) => ({ db: { transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) } });
  function makeBilling(tx: unknown) {
    return new BillingOutcomeHandler(db(tx) as never, { addEvent: jest.fn() } as never, {} as never);
  }
  function makePause(tx: unknown) {
    return new PauseManager(db(tx) as never, {} as never);
  }
  function makeSub(tx: unknown) {
    return new SubscriptionManager(db(tx) as never, { addEvent: jest.fn() } as never, {} as never);
  }
  function makeInvoice(tx: unknown) {
    return new InvoiceOutcomeHandler(
      db(tx) as never,
      { addEvent: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { lookupContactForContract: jest.fn() } as never,
    );
  }

  it.each(cases)('%s', async (_name, run) => {
    const { tx, trace } = makeTrackedTx();
    await run(tx).catch(() => undefined);
    expect(trace[0]).toBe('lock');
    expect(trace.filter((t) => t === 'lock')).toHaveLength(1);
  });
});
