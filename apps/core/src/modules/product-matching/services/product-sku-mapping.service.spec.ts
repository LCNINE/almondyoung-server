import { BadRequestException } from '@nestjs/common';
import { ProductSkuMappingService } from './product-sku-mapping.service';

describe('ProductSkuMappingService', () => {
  it('does not resolve or wake variant matching without SKU links', async () => {
    const tx = {};
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
    };
    const fulfillmentBacklog = {
      wakeBacklogsWaitingForVariant: jest.fn(),
    };
    const service = new ProductSkuMappingService(
      dbService as any,
      productSellableQuantity as any,
      fulfillmentBacklog as any,
    );

    await expect(service.upsert('variant-1', { links: [] } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(productSellableQuantity.recalculateAndPublishForVariant).not.toHaveBeenCalled();
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).not.toHaveBeenCalled();
  });
});
