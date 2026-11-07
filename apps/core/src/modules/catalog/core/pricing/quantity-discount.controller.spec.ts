import { QuantityDiscountController } from './quantity-discount.controller';
import { QuantityDiscountService } from './quantity-discount.service';

describe('QuantityDiscountController', () => {
  const saved = {
    id: 'qd1',
    enabled: true,
    startsOn: null,
    endsOn: null,
    tiers: [{ minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 }],
  };

  function make() {
    const service = {
      getForVersion: jest.fn().mockResolvedValue(saved),
      upsertForDraft: jest.fn().mockResolvedValue(saved),
    };
    const controller = new QuantityDiscountController(service as unknown as QuantityDiscountService);
    return { controller, service };
  }

  it('reads the table of the version', async () => {
    const { controller, service } = make();

    await expect(controller.get('m1', 'v1')).resolves.toEqual(saved);
    expect(service.getForVersion).toHaveBeenCalledWith('m1', 'v1');
  });

  it('saves with missing period fields treated as no period', async () => {
    const { controller, service } = make();

    await controller.upsert('m1', 'v1', { enabled: true, tiers: saved.tiers });

    expect(service.upsertForDraft).toHaveBeenCalledWith('m1', 'v1', {
      enabled: true,
      startsOn: null,
      endsOn: null,
      tiers: saved.tiers,
      variantOverrides: [],
    });
  });
});
