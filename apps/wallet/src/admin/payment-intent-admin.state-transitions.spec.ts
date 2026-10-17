import type { DbService } from '@app/db';
import type { WalletSchema } from '../schema';
import { PaymentIntentAdminService } from './payment-intent-admin.service';

/** 종류 고치기 이력(KIND_CHANGED)이 «상태 이력» 읽기 경로로 사유·payload 와 함께 나온다 (#1016 40번). */
describe('PaymentIntentAdminService.getStateTransitions — reasonCode·payload', () => {
  it('KIND_CHANGED 행이 reasonCode 와 {fromKind,toKind} payload 를 그대로 돌려준다', async () => {
    const transition = {
      id: 't1',
      entityType: 'REFUND',
      entityId: 'rf-1',
      previousStatus: 'SUCCEEDED',
      newStatus: 'SUCCEEDED',
      reasonCode: 'KIND_CHANGED',
      payload: { fromKind: 'ITEM_CANCEL', toKind: null },
      triggeredByType: 'ADMIN',
      triggeredById: 'admin-7',
      correlationId: 'kind-change:rf-1:1',
      occurredAt: new Date('2026-10-17T00:00:00Z'),
    };
    const results = [[{ id: 'i1' }], [], [{ id: 'rf-1' }], [transition]];
    const chain = (): unknown => {
      const rows = results.shift();
      const c: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c;
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
      return c;
    };
    const db = { select: () => chain() };
    const service = new PaymentIntentAdminService({ db } as unknown as DbService<WalletSchema>, {} as never);

    const out = await service.getStateTransitions('i1');

    expect(out).toEqual([
      expect.objectContaining({
        reasonCode: 'KIND_CHANGED',
        payload: { fromKind: 'ITEM_CANCEL', toKind: null },
        triggeredByType: 'ADMIN',
        triggeredById: 'admin-7',
      }),
    ]);
  });
});
