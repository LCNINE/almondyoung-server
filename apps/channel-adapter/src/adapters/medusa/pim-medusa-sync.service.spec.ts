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
      setProductToDraft: jest.fn().mockResolvedValue(undefined),
    };
    const mappingRepo = {
      findByPimMasterId: jest.fn().mockResolvedValue(params?.mapping ?? null),
      update: jest.fn().mockResolvedValue(undefined),
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

describe('PimMedusaSyncService.handleProductMasterDeleted', () => {
  function createService(mapping?: { medusaProductId?: string | null } | null) {
    const medusaClient = {
      setProductToDraft: jest.fn().mockResolvedValue(undefined),
    };
    const mappingRepo = {
      findByPimMasterId: jest.fn().mockResolvedValue(mapping ?? null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PimMedusaSyncService(medusaClient as any, mappingRepo as any);

    return { service, medusaClient, mappingRepo };
  }

  it('drafts the mapped Medusa product and retains the PIM-Medusa mapping', async () => {
    const { service, medusaClient, mappingRepo } = createService({ medusaProductId: 'prod_1' });

    await service.handleProductMasterDeleted({
      masterId: 'master-1',
      deletedAt: '2026-06-07T00:00:00.000Z',
    });

    expect(mappingRepo.findByPimMasterId).toHaveBeenCalledWith('master-1');
    expect(medusaClient.setProductToDraft).toHaveBeenCalledWith('prod_1');
    expect(mappingRepo.update).toHaveBeenCalledWith(
      'master-1',
      expect.objectContaining({
        lastSyncAction: 'updated',
        lastSyncedAt: expect.any(Date),
      }),
    );
    expect((mappingRepo as any).delete).toBeUndefined();
  });

  it('does not call Medusa when a deleted master has no retained mapping', async () => {
    const { service, medusaClient, mappingRepo } = createService(null);

    await service.handleProductMasterDeleted({
      masterId: 'master-1',
      deletedAt: '2026-06-07T00:00:00.000Z',
    });

    expect(mappingRepo.update).not.toHaveBeenCalled();
    expect(medusaClient.setProductToDraft).not.toHaveBeenCalled();
  });
});
