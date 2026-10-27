import { physicalQuantity } from './physical-quantity';

describe('physicalQuantity', () => {
  it('창고 안에 있는 네 상태(보유·불량·이동중·반품 검수 대기)를 모두 더한다', () => {
    expect(physicalQuantity({ onHandQty: 1, defectiveQty: 2, inTransferQty: 3, returnedQty: 4 })).toBe(10);
  });
});
