import { DbService } from '@app/db';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';
import {
  customerFileRejection,
  FILE_RESUBMIT_GRACE_MS,
  PrintFileRejectionManager,
} from './print-file-rejection.manager';

const FILE = 'file-1';
const NOW = new Date('2026-11-24T03:00:00Z');

function fakeDb(updatedRows: number) {
  const updates: Record<string, unknown>[] = [];
  const trx = {
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return {
          where: () => {
            const result = Promise.resolve(undefined) as Promise<unknown> & { returning: () => Promise<unknown[]> };
            result.returning = () => Promise.resolve(Array.from({ length: updatedRows }, () => ({ id: 'po-1' })));
            return result;
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () =>
            Promise.resolve([{ channelOrderId: 'order_1', customerId: 'user-1', productName: '소량 청첩장' }]),
        }),
      }),
    }),
  };
  const db = { run: (fn: (tx: typeof trx) => unknown) => fn(trx) } as unknown as DbService<typeof wmsSchema>;

  return { db, updates };
}

function setup(updatedRows = 1) {
  const { db, updates } = fakeDb(updatedRows);
  const enqueue = jest.fn(() => Promise.resolve());
  const manager = new PrintFileRejectionManager(db, { enqueue } as never);

  return { manager, enqueue, updates };
}

function row(overrides: Partial<PrintOrderRow> = {}): PrintOrderRow {
  return {
    id: 'po-1',
    salesOrderId: 'so-1',
    salesOrderLineId: 'line-1',
    printFileId: FILE,
    fileRejectedAt: null,
    fileResubmittedAt: null,
    ...overrides,
  } as PrintOrderRow;
}

describe('customerFileRejection', () => {
  it.each([
    ['a file error on a customer file', row(), { ordstat: 10, jobstat: 123 }, 123],
    ['an error the customer cannot fix', row(), { ordstat: 10, jobstat: 128 }, null],
    ['an order cancelled on wowpress', row(), { ordstat: 90, jobstat: 123 }, null],
    ['an almond design line', row({ printFileId: null }), { ordstat: 10, jobstat: 123 }, null],
  ])('%s', (_label, current, detail, expected) => {
    expect(customerFileRejection(current, detail)).toBe(expected);
  });
});

describe('PrintFileRejectionManager.observe', () => {
  it('marks the line and queues the customer notice in the same transaction', async () => {
    const { manager, enqueue, updates } = setup();

    await manager.observe(row(), { ordstat: 10, jobstat: 123 }, NOW);

    expect(updates[0]).toMatchObject({ fileRejectedAt: NOW, fileResubmittedAt: null });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PrintFileRejected',
        payload: expect.objectContaining({ customerId: 'user-1', jobstat: 123, channelOrderId: 'order_1' }),
      }),
      expect.anything(),
    );
  });

  it('does not notify when another reader already marked it (conditional update hit no row)', async () => {
    const { manager, enqueue } = setup(0);

    await manager.observe(row(), { ordstat: 10, jobstat: 123 }, NOW);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('clears both marks once wowpress shows no file error', async () => {
    const { manager, updates } = setup();

    await manager.observe(
      row({ fileRejectedAt: NOW, fileResubmittedAt: new Date(NOW.getTime() - FILE_RESUBMIT_GRACE_MS) }),
      { ordstat: 20, jobstat: null },
      NOW,
    );

    expect(updates).toEqual([expect.objectContaining({ fileRejectedAt: null, fileResubmittedAt: null })]);
  });

  it('writes nothing for a healthy line that was never marked', async () => {
    const { manager, updates } = setup();

    await manager.observe(row(), { ordstat: 20, jobstat: null }, NOW);

    expect(updates).toEqual([]);
  });
});
