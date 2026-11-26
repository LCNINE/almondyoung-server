import { returnBinPutawayResponse } from './return-bin.service';

describe('returnBinPutawayResponse', () => {
  it('적치한 상품과 실제로 쓴 로케이션을 응답에 싣는다', () => {
    const items = [
      {
        skuId: 'sku-2',
        skuCode: 'B-1',
        skuName: '남은 상품',
        sourceLocationId: 'loc-2',
        locationCode: 'A-02',
        qty: 1,
      },
    ];

    const response = returnBinPutawayResponse({
      bin: { id: 'bin-1', barcode: 'RB-1' },
      warehouseId: 'wh-1',
      putAwayQty: 3,
      sku: { id: 'sku-1', code: 'A-1', name: '적치 상품' },
      locationCode: 'A-01',
      items,
    });

    expect(response).toEqual({
      returnBin: { id: 'bin-1', barcode: 'RB-1', warehouseId: 'wh-1' },
      putAwayQty: 3,
      skuId: 'sku-1',
      skuCode: 'A-1',
      skuName: '적치 상품',
      locationCode: 'A-01',
      items,
    });
  });
});
