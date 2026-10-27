import { BillingOutcomeHandler } from './billing-outcome.handler';

describe('BillingOutcomeHandler.handleExpiration 회원 잠금', () => {
  it('트랜잭션 첫 문장으로 회원 잠금을 건다', async () => {
    const order: string[] = [];
    const update = jest.fn(() => {
      order.push('update');
      const c: Record<string, jest.Mock> = {};
      c.set = jest.fn(() => c);
      c.where = jest.fn(() => c);
      // 닫을 자격이 없으면 이후 단계 없이 끝난다
      c.returning = jest.fn(async () => []);
      return c;
    });
    const execute = jest.fn(async () => {
      order.push('user-lock');
    });
    const tx = { execute, update };
    const db = { db: { transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) } };
    const handler = new BillingOutcomeHandler(db as never, {} as never, {} as never);

    await handler.handleExpiration('e1', 'u1', 'c1');

    expect(order).toEqual(['user-lock', 'update']);
    const text = JSON.stringify(execute.mock.calls[0]);
    expect(text).toContain('membership-signup:');
    expect(text).toContain('u1');
  });
});
