import { fulfillmentModeOfHolders } from './fulfillment-mode';

const ours = { holderId: 'our', isOurAsset: true };
const vendorA = { holderId: 'a', isOurAsset: false };
const vendorB = { holderId: 'b', isOurAsset: false };

describe('fulfillmentModeOfHolders', () => {
  it('전부 자사면 in_house', () => {
    expect(fulfillmentModeOfHolders([ours, ours])).toEqual({ fulfillmentMode: 'in_house', ownerId: null });
  });

  it('창고 몫이 없으면 in_house', () => {
    expect(fulfillmentModeOfHolders([])).toEqual({ fulfillmentMode: 'in_house', ownerId: null });
  });

  it('전부 한 위탁 업체면 3pl 과 그 화주', () => {
    expect(fulfillmentModeOfHolders([vendorA, vendorA])).toEqual({ fulfillmentMode: '3pl', ownerId: 'a' });
  });

  it('자사와 위탁이 섞이면 mixed', () => {
    expect(fulfillmentModeOfHolders([ours, vendorA])).toEqual({ mixed: true });
  });

  it('위탁 업체 둘이 섞이면 mixed', () => {
    expect(fulfillmentModeOfHolders([vendorA, vendorB])).toEqual({ mixed: true });
  });
});
