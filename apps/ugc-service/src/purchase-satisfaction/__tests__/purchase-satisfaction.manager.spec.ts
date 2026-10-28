import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import type { UgcServiceSchema } from '../../db/schema';
import type { UpsertPurchaseSatisfactionDto } from '../dto/upsert-purchase-satisfaction.dto';
import { PurchaseSatisfactionManager } from '../purchase-satisfaction.manager';
import type { PurchaseSatisfactionRow } from '../types';

const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const ORDER = 'order_01TEST';

const existingRow = (over: Partial<PurchaseSatisfactionRow> = {}): PurchaseSatisfactionRow => ({
  id: '33333333-3333-4333-8333-333333333333',
  orderId: ORDER,
  orderDisplayId: 1001,
  userId: USER,
  rating: 2,
  reasons: ['OTHER'],
  memo: null,
  checkedAt: null,
  checkedBy: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

const dto = (over: Partial<UpsertPurchaseSatisfactionDto>): UpsertPurchaseSatisfactionDto => ({
  userId: USER,
  orderDisplayId: 1001,
  rating: 2,
  ...over,
});

const setup = (existing: PurchaseSatisfactionRow | undefined) => {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({ for: async () => (existing ? [existing] : []) }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { onConflictDoNothing: () => ({ returning: async () => (existing ? [] : [v]) }) };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updated.push(v);
        return { where: () => ({ returning: async () => [v] }) };
      },
    }),
  };
  const db = { run: (fn: (t: unknown) => unknown) => fn(tx) } as unknown as DbService<UgcServiceSchema>;
  return { manager: new PurchaseSatisfactionManager(db), inserted, updated };
};

describe('PurchaseSatisfactionManager.upsert', () => {
  it('4점 이상이면 사유와 메모를 비워 저장한다', async () => {
    const { manager, updated } = setup(existingRow({ rating: 2, reasons: ['PAYMENT_ERROR'], memo: '오류' }));
    await manager.upsert(ORDER, dto({ rating: 4 }));
    expect(updated[0]).toMatchObject({ rating: 4, reasons: [], memo: null });
  });

  it('4점 이상인데 사유나 메모를 보내면 BadRequestError', async () => {
    const { manager } = setup(undefined);
    await expect(manager.upsert(ORDER, dto({ rating: 5, reasons: ['OTHER'] }))).rejects.toBeInstanceOf(BadRequestError);
    await expect(manager.upsert(ORDER, dto({ rating: 4, memo: 'x' }))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('4점 이상에서 빈 메모나 공백 메모는 없는 것으로 보고 저장한다', async () => {
    const { manager, inserted } = setup(undefined);
    await manager.upsert(ORDER, dto({ rating: 4, memo: '' }));
    await manager.upsert(ORDER, dto({ rating: 5, memo: '   ' }));
    expect(inserted[0]).toMatchObject({ rating: 4, memo: null });
    expect(inserted[1]).toMatchObject({ rating: 5, memo: null });
  });

  it('내용이 바뀌면 확인 상태를 되돌린다', async () => {
    const { manager, updated } = setup(
      existingRow({ rating: 2, reasons: ['OTHER'], memo: null, checkedAt: new Date(), checkedBy: ADMIN }),
    );
    await manager.upsert(ORDER, dto({ rating: 2, reasons: ['OTHER', 'PAYMENT_ERROR'] }));
    expect(updated[0]).toMatchObject({ checkedAt: null, checkedBy: null });
  });

  it('같은 내용을 다시 저장하면 확인 상태를 유지한다', async () => {
    const { manager, updated } = setup(
      existingRow({
        rating: 2,
        reasons: ['OTHER', 'PAYMENT_ERROR'],
        memo: '메모',
        checkedAt: new Date(),
        checkedBy: ADMIN,
      }),
    );
    await manager.upsert(ORDER, dto({ rating: 2, reasons: ['PAYMENT_ERROR', 'OTHER'], memo: ' 메모 ' }));
    expect(updated[0]).not.toHaveProperty('checkedAt');
    expect(updated[0]).not.toHaveProperty('checkedBy');
  });

  it('동시에 먼저 저장되어 insert 가 충돌하면 기존 행을 잠가 갱신한다', async () => {
    const { manager, inserted, updated } = setup(
      existingRow({ rating: 2, reasons: ['OTHER'], checkedAt: new Date(), checkedBy: ADMIN }),
    );
    await manager.upsert(ORDER, dto({ rating: 1, reasons: ['OTHER'] }));
    expect(inserted).toHaveLength(1);
    expect(updated[0]).toMatchObject({ rating: 1, checkedAt: null, checkedBy: null });
  });

  it('기존 행이 없으면 새로 만든다', async () => {
    const { manager, inserted, updated } = setup(undefined);
    await manager.upsert(ORDER, dto({ rating: 3, orderDisplayId: 2002 }));
    expect(inserted[0]).toMatchObject({ orderId: ORDER, orderDisplayId: 2002, userId: USER, rating: 3 });
    expect(updated).toHaveLength(0);
  });
});
