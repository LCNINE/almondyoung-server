import type { UpsertMatchingDto } from '@/lib/types/dto/matching';
import * as transformers from './transformers';

const buildUpsertMatchingPayload = (
  transformers as unknown as {
    buildUpsertMatchingPayload: (input: {
      masterId?: string | null;
      links: { skuId: string; quantity: number }[];
      policy: UpsertMatchingDto['policy'];
      changedLinks: boolean;
    }) => UpsertMatchingDto;
  }
).buildUpsertMatchingPayload;

describe('buildUpsertMatchingPayload', () => {
  it('omits links when only the stock policy changed', () => {
    expect(
      buildUpsertMatchingPayload({
        masterId: 'master-1',
        links: [],
        policy: {
          preStockSellable: true,
          alwaysSellableZeroStock: false,
          availabilityOverride: 'manual_out_of_stock',
        },
        changedLinks: false,
      }),
    ).toEqual({
      masterId: 'master-1',
      policy: {
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
    });
  });

  it('includes links when the SKU links changed', () => {
    expect(
      buildUpsertMatchingPayload({
        masterId: 'master-1',
        links: [{ skuId: 'sku-1', quantity: 2 }],
        policy: {
          preStockSellable: false,
          alwaysSellableZeroStock: false,
          availabilityOverride: null,
        },
        changedLinks: true,
      }),
    ).toEqual({
      masterId: 'master-1',
      links: [{ skuId: 'sku-1', quantity: 2 }],
      policy: {
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        availabilityOverride: null,
      },
    });
  });
});
