jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'product-stream' } },
  }),
  { virtual: true },
);

import { BadRequestError } from '@app/shared';
import { ProductMastersController } from './product-masters.controller';
import { MAX_BULK_PRODUCTS } from '../../../operations/bulk/dto/bulk-operations.dto';

describe('GET /masters/selection', () => {
  const item = (masterId: string) => ({
    masterId,
    hideMembershipPriceForNonMembers: false,
    isVisibleToMembersOnly: false,
    isOverseas: false,
  });

  function build(total: number) {
    const items = Array.from({ length: Math.min(total, 3) }, (_, i) => item(`id-${i}`));
    const service = { getMasterSelection: jest.fn().mockResolvedValue({ items, total }) };
    const controller = new ProductMastersController({} as never, service as never, {} as never);
    return { controller, service };
  }

  it('필터를 서비스에 그대로 넘긴다', async () => {
    const { controller, service } = build(2);
    await controller.getMasterSelection({ brand: '정관장', mode: 'all' } as never);
    expect(service.getMasterSelection).toHaveBeenCalledWith(expect.objectContaining({ brand: '정관장', mode: 'all' }));
  });

  it('상한 이하는 그대로 반환한다', async () => {
    const { controller } = build(MAX_BULK_PRODUCTS);
    await expect(controller.getMasterSelection({} as never)).resolves.toMatchObject({
      total: MAX_BULK_PRODUCTS,
    });
  });

  it('상한을 넘으면 BadRequestError 를 던진다', async () => {
    const { controller } = build(MAX_BULK_PRODUCTS + 1);
    await expect(controller.getMasterSelection({} as never)).rejects.toThrow(BadRequestError);
    await expect(controller.getMasterSelection({} as never)).rejects.toThrow(
      '선택 가능한 범위를 넘었습니다. 필터를 좁혀주세요.',
    );
  });
});
