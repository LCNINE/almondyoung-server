import { UnauthorizedException } from '@nestjs/common';
import { ReturnBinController } from './return-bin.controller';

describe('ReturnBinController', () => {
  const returnBins = {
    register: jest.fn().mockResolvedValue({ id: 'b' }),
    lookup: jest.fn().mockResolvedValue({ id: 'b' }),
  };
  const controller = new ReturnBinController(returnBins as never, {} as never);

  it('등록은 인증된 작업자 이름으로 위임한다', async () => {
    await controller.register({ warehouseId: 'w', barcode: 'RB-1' }, { userId: 'u-1', roles: [] });
    expect(returnBins.register).toHaveBeenCalledWith({ warehouseId: 'w', barcode: 'RB-1' }, { id: 'u-1', roles: [] });
  });

  it('작업자 없이는 등록하지 않는다', () => {
    expect(() => controller.register({ warehouseId: 'w', barcode: 'RB-1' }, undefined)).toThrow(UnauthorizedException);
  });

  it('조회는 바코드·창고로 위임한다', async () => {
    await controller.lookup('RB-1', 'w');
    expect(returnBins.lookup).toHaveBeenCalledWith('RB-1', 'w');
  });

  it('박스에서 빼기는 멱등 키와 함께 되돌림 서비스로 위임한다', async () => {
    const returns = { removeToReturnBin: jest.fn().mockResolvedValue({ exited: false }) };
    const delegating = new ReturnBinController(returnBins as never, returns as never);
    await delegating.removeFromBox('s-1', { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 }, 'key-1', {
      userId: 'u-1',
      roles: [],
    });
    expect(returns.removeToReturnBin).toHaveBeenCalledWith(
      's-1',
      { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 },
      { id: 'u-1', roles: [] },
      'key-1',
    );
  });
});
