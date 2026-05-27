import { PimMedusaSyncService } from './pim-medusa-sync.service';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';

describe('PimMedusaSyncService.handleProductSellableQuantityChanged', () => {
  const payload: ProductSellableQuantityChangedPayload = {
    variantId: 'pim-var-1',
    masterId: 'master-1',
    versionId: 'version-1',
    matchingId: 'matching-1',
    sellableQuantity: 7,
    stockBoundQuantity: 7,
    isSellable: true,
    reason: 'SELLABLE',
    calculatedAt: '2026-05-27T00:00:00.000Z',
  };

  function createService(params?: {
    mapping?: { medusaProductId?: string | null } | null;
    productByHandle?: { id: string } | null;
  }) {
    const medusaClient = {
      applyProductSellableQuantityProjection: jest.fn().mockResolvedValue(undefined),
      findProductByHandle: jest.fn().mockResolvedValue(params?.productByHandle ?? null),
    };
    const mappingRepo = {
      findByPimMasterId: jest.fn().mockResolvedValue(params?.mapping ?? null),
    };
    const service = new PimMedusaSyncService(medusaClient as any, mappingRepo as any);

    return { service, medusaClient, mappingRepo };
  }

  it('maps the PIM master to an existing Medusa product and applies the projection', async () => {
    const { service, medusaClient, mappingRepo } = createService({
      mapping: { medusaProductId: 'prod_1' },
    });

    await service.handleProductSellableQuantityChanged(payload);

    expect(mappingRepo.findByPimMasterId).toHaveBeenCalledWith('master-1');
    expect(medusaClient.findProductByHandle).not.toHaveBeenCalled();
    expect(medusaClient.applyProductSellableQuantityProjection).toHaveBeenCalledWith({
      ...payload,
      medusaProductId: 'prod_1',
    });
  });

  it('falls back to Medusa handle lookup when the persisted product mapping is missing', async () => {
    const { service, medusaClient } = createService({
      mapping: null,
      productByHandle: { id: 'prod_from_handle' },
    });

    await service.handleProductSellableQuantityChanged(payload);

    expect(medusaClient.findProductByHandle).toHaveBeenCalledWith('master-1');
    expect(medusaClient.applyProductSellableQuantityProjection).toHaveBeenCalledWith({
      ...payload,
      medusaProductId: 'prod_from_handle',
    });
  });

  it('throws when no Medusa product mapping can be resolved so the inbox worker can retry', async () => {
    const { service, medusaClient } = createService({
      mapping: null,
      productByHandle: null,
    });

    await expect(service.handleProductSellableQuantityChanged(payload)).rejects.toThrow(
      'Medusa product not found for ProductSellableQuantityChanged masterId=master-1, variantId=pim-var-1',
    );
    expect(medusaClient.applyProductSellableQuantityProjection).not.toHaveBeenCalled();
  });

  it('throws when the event lacks masterId because channel-adapter must not guess product identity', async () => {
    const { service, medusaClient } = createService();

    await expect(
      service.handleProductSellableQuantityChanged({
        ...payload,
        masterId: null,
      }),
    ).rejects.toThrow('ProductSellableQuantityChanged missing masterId for variant pim-var-1');
    expect(medusaClient.applyProductSellableQuantityProjection).not.toHaveBeenCalled();
  });
});
