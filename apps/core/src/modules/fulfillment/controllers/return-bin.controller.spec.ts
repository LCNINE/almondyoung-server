import { UnauthorizedException } from '@nestjs/common';
import { ReturnBinController } from './return-bin.controller';

describe('ReturnBinController', () => {
  const returnBins = {
    register: jest.fn().mockResolvedValue({ id: 'b' }),
    lookup: jest.fn().mockResolvedValue({ id: 'b' }),
  };
  const controller = new ReturnBinController(returnBins as never);

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
});
