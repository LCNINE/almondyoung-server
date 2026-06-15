import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductSkuMappingController } from './product-sku-mapping.controller';

describe('ProductSkuMappingController', () => {
  it('passes variant batch request IDs to the service', async () => {
    const response = { data: [] };
    const service = {
      getVariantMatchingBatch: jest.fn().mockResolvedValue(response),
    };
    const controller = new ProductSkuMappingController(service as never);
    const variantIds = ['11111111-1111-1111-1111-111111111111'];

    await expect(controller.getVariantMatchingBatch({ variantIds })).resolves.toBe(response);
    expect(service.getVariantMatchingBatch).toHaveBeenCalledWith(variantIds);
  });

  it('preserves service BadRequestException for invalid batch input', async () => {
    const error = new BadRequestException('variantIds must not exceed 500 items');
    const service = {
      getVariantMatchingBatch: jest.fn().mockRejectedValue(error),
    };
    const controller = new ProductSkuMappingController(service as never);

    await expect(controller.getVariantMatchingBatch({ variantIds: [] })).rejects.toBe(error);
  });

  it('preserves service NotFoundException when saving stock policy for a missing variant', async () => {
    const error = new NotFoundException('Variant not found');
    const service = {
      updateVariantStockPolicy: jest.fn().mockRejectedValue(error),
    };
    const controller = new ProductSkuMappingController(service as never);

    await expect(controller.updateVariantStockPolicy('variant-1', { preStockSellable: false })).rejects.toBe(error);
  });
});
