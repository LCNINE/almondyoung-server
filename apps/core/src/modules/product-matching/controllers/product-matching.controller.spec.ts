import { NewSkuPermissionGuard } from '../guards/new-sku-permission.guard';
import { Test } from '@nestjs/testing';
import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { ProductMatchingService } from '../services/product-matching.service';
import { NameMatchService } from '../name-match/name-match.service';
import { BadRequestException } from '@nestjs/common';

import { ProductMatchingController } from './product-matching.controller';
import { ResolveMatchingDto } from '../dto/resolve-matching.dto';

describe('ProductMatchingController', () => {
  it('preserves service BadRequestException for invalid void resolution input', async () => {
    const error = new BadRequestException('void strategy does not accept SKU mappings.');
    const service = {
      resolveMatchingPending: jest.fn().mockRejectedValue(error),
    };
    const controller = new ProductMatchingController(
      service as never,
      { preview: jest.fn(), apply: jest.fn() } as never,
    );

    await expect(
      controller.resolveMatchingPending('11111111-1111-1111-1111-111111111111', {
        strategy: 'void',
        skuIds: ['22222222-2222-2222-2222-222222222222'],
      } as ResolveMatchingDto),
    ).rejects.toBe(error);
  });
});

describe('ProductMatchingController name matching and shipping filter', () => {
  const getOrderLines = jest.fn().mockResolvedValue({ data: [], total: 0 });
  const preview = jest.fn().mockResolvedValue({ candidates: 0, waitingOrderCandidates: 0, sample: [] });
  const apply = jest.fn().mockResolvedValue({ resolved: 0, skipped: 0, failed: [] });
  let controller: ProductMatchingController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [ProductMatchingController],
      providers: [
        { provide: ProductMatchingService, useValue: { getOrderLines } },
        { provide: NameMatchService, useValue: { preview, apply } },
      ],
    })
      .overrideGuard(NewSkuPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ProductMatchingController);
  });

  it.each(['true', 'false', undefined])('forwards excludeShipped=%s as a boolean', async (excludeShipped) => {
    await controller.getOrderLines(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '50',
      '0',
      excludeShipped,
    );

    expect(getOrderLines).toHaveBeenCalledWith(expect.objectContaining({ excludeShipped: excludeShipped === 'true' }));
  });

  it('delegates preview and apply and declares their existing permissions', async () => {
    expect(await controller.previewNameMatch()).toEqual({ candidates: 0, waitingOrderCandidates: 0, sample: [] });
    expect(await controller.applyNameMatch()).toEqual({ resolved: 0, skipped: 0, failed: [] });
    expect(preview).toHaveBeenCalledWith();
    expect(apply).toHaveBeenCalledWith();
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.previewNameMatch)).toEqual(['order.order.read']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.applyNameMatch)).toEqual(['order.matching.write']);
  });
});
