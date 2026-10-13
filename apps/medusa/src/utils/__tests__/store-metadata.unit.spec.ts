import { Modules } from '@medusajs/framework/utils';
import { updateStoreMetadata } from '../store-metadata';

describe('updateStoreMetadata', () => {
  it('re-reads the store under one shared lock and keeps other writers keys', async () => {
    const locks: string[] = [];
    const updateStores = jest.fn();
    const services: Record<string, unknown> = {
      [Modules.STORE]: {
        listStores: async () => [{ id: 'store_1', metadata: { shippingAreaTemplates: ['kept'], timeSaleSettings: 'old' } }],
        updateStores,
      },
      [Modules.LOCKING]: {
        execute: async (key: string, run: () => Promise<unknown>) => {
          locks.push(key);
          return run();
        },
      },
    };
    const container = { resolve: (key: string) => services[key] } as never;

    const value = await updateStoreMetadata(container, () => ({ set: { timeSaleSettings: 'new' }, value: 1 }));

    expect(value).toBe(1);
    expect(locks).toEqual(['store-metadata']);
    expect(updateStores).toHaveBeenCalledWith('store_1', {
      metadata: { shippingAreaTemplates: ['kept'], timeSaleSettings: 'new' },
    });
  });
});
