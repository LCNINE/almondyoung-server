import { BadRequestException } from '@nestjs/common';

import { ProductMatchingController } from './product-matching.controller';
import { ResolveMatchingDto } from '../dto/resolve-matching.dto';

describe('ProductMatchingController', () => {
  it('preserves service BadRequestException for invalid void resolution input', async () => {
    const error = new BadRequestException('void strategy does not accept SKU mappings.');
    const service = {
      resolveMatchingPending: jest.fn().mockRejectedValue(error),
    };
    const controller = new ProductMatchingController(service as never);

    await expect(
      controller.resolveMatchingPending('11111111-1111-1111-1111-111111111111', {
        strategy: 'void',
        skuIds: ['22222222-2222-2222-2222-222222222222'],
      } as ResolveMatchingDto),
    ).rejects.toBe(error);
  });
});
