import type { DbService } from '@app/db';
import type { ReplenishmentProfileService } from '../inventory/replenishment/demand/replenishment-profile.service';
import { inventorySchema } from '../inventory/schema/inventory.schema';
import { DemoService } from './demo.service';

describe('DemoService shipment history', () => {
  it('uses the canonical stock summary availability for catalog quantities', async () => {
    const sourceTables: unknown[] = [];
    const select = jest
      .fn()
      .mockImplementationOnce(() => ({
        from: (table: unknown) => {
          sourceTables.push(table);
          return { where: () => Promise.resolve([{ id: '019f1004-0001-7000-a000-000000000001' }]) };
        },
      }))
      .mockImplementationOnce(() => ({
        from: (table: unknown) => {
          sourceTables.push(table);
          return {
            where: () => ({
              groupBy: () =>
                Promise.resolve([{ skuId: '019f1004-0001-7000-a000-000000000001', quantity: 1 }]),
            }),
          };
        },
      }));
    const dbService = {
      run: (operation: (trx: { select: typeof select }) => unknown) => operation({ select }),
    } as unknown as DbService<typeof inventorySchema>;
    const service = new DemoService(dbService, {} as ReplenishmentProfileService);

    const result = await service.catalog();

    expect(sourceTables[1]).toBe(inventorySchema.stockSummary);
    expect(result.items[0]).toMatchObject({ availableQuantity: 1 });
  });

  it('returns a safe timestamp-normalized projection of at most the latest 20 mock shipments', async () => {
    const limit = jest.fn().mockResolvedValue([
      {
        reference: 'DEMO-ORDER-002',
        trackingNumber: '900000000002',
        status: 'registered',
        createdAt: new Date('2026-09-16T01:00:00.000Z'),
        updatedAt: new Date('2026-09-16T02:00:00.000Z'),
        registeredAt: new Date('2026-09-16T02:00:00.000Z'),
        canceledAt: null,
      },
    ]);
    const orderBy = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ orderBy });
    const select = jest.fn().mockReturnValue({ from });
    const dbService = {
      run: (operation: (trx: { select: typeof select }) => unknown) => operation({ select }),
    } as unknown as DbService<typeof inventorySchema>;
    const service = new DemoService(dbService, {} as ReplenishmentProfileService);

    await expect(service.shipments()).resolves.toEqual({
      items: [
        {
          reference: 'DEMO-ORDER-002',
          trackingNumber: '900000000002',
          status: 'registered',
          createdAt: '2026-09-16T01:00:00.000Z',
          updatedAt: '2026-09-16T02:00:00.000Z',
          registeredAt: '2026-09-16T02:00:00.000Z',
          canceledAt: null,
        },
      ],
    });
    expect(limit).toHaveBeenCalledWith(20);
  });
});
