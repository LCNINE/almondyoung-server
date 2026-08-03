import type { UpsertMatchingDto } from '@/lib/types/dto/matching';
import * as transformers from './transformers';

const buildUpsertMatchingPayload = (
  transformers as unknown as {
    buildUpsertMatchingPayload: (input: {
      masterId?: string | null;
      links: { skuId: string; skuName?: string; quantity: number }[];
      policy: UpsertMatchingDto['policy'];
      changedLinks: boolean;
    }) => UpsertMatchingDto;
  }
).buildUpsertMatchingPayload;

describe('isSameSkuLinks', () => {
  const { isSameSkuLinks } = transformers;

  it('ignores the display-only skuName so an unchanged matching is not re-saved', () => {
    expect(
      isSameSkuLinks(
        [{ skuId: 'sku-1', skuName: '퍼마블렌드 블랙', quantity: 2 }],
        [{ skuId: 'sku-1', quantity: 2 }]
      )
    ).toBe(true);
  });

  it('detects a quantity change', () => {
    expect(
      isSameSkuLinks(
        [{ skuId: 'sku-1', quantity: 1 }],
        [{ skuId: 'sku-1', quantity: 2 }]
      )
    ).toBe(false);
  });

  it('detects an added link', () => {
    expect(
      isSameSkuLinks(
        [
          { skuId: 'sku-1', quantity: 1 },
          { skuId: 'sku-2', quantity: 1 },
        ],
        [{ skuId: 'sku-1', quantity: 1 }]
      )
    ).toBe(false);
  });
});

describe('buildUpsertMatchingPayload', () => {
  it('strips skuName from the payload sent to the server', () => {
    expect(
      buildUpsertMatchingPayload({
        masterId: 'master-1',
        links: [{ skuId: 'sku-1', skuName: '퍼마블렌드 블랙', quantity: 2 }],
        policy: undefined,
        changedLinks: true,
      }).links
    ).toEqual([{ skuId: 'sku-1', quantity: 2 }]);
  });


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
      })
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
      })
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

describe('getProductSellableReasonLabel', () => {
  it('returns Korean operation labels for known projection reasons', () => {
    expect(
      transformers.getProductSellableReasonLabel('MANUAL_OUT_OF_STOCK')
    ).toBe('수동 품절');
    expect(transformers.getProductSellableReasonLabel('MATCHING_MISSING')).toBe(
      '매칭 없음'
    );
  });

  it('falls back to the original reason code for unknown values', () => {
    expect(transformers.getProductSellableReasonLabel('NEW_REASON')).toBe(
      'NEW_REASON'
    );
  });
});
