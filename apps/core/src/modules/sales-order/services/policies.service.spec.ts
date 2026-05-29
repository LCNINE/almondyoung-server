import { PoliciesService } from './policies.service';

describe('SalesOrder PoliciesService', () => {
  it('policy row가 없으면 재고 관리를 기본값으로 사용한다', async () => {
    const db = {
      db: {
        query: {
          salesVariantPolicies: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        },
      },
    };
    const service = new PoliciesService(db as any);

    await expect(service.getVariantPolicy('variant-1')).resolves.toMatchObject({
      variantId: 'variant-1',
      inventoryManagement: true,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
    });
  });
});
