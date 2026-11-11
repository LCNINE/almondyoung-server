import { UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { validate } from 'class-validator';
import { ReturnBinPutawayDto, ReturnBinRemovalDto } from '../dto/return-bin.dto';
import { BoxReturnService } from '../services/box-return.service';
import { ReturnBinService } from '../services/return-bin.service';
import { ReturnBinController } from './return-bin.controller';

describe('ReturnBinController', () => {
  const returnBins = {
    register: jest.fn().mockResolvedValue({ id: 'b' }),
    lookup: jest.fn().mockResolvedValue({ id: 'b' }),
    mine: jest.fn().mockResolvedValue({ id: null, items: [] }),
    putaway: jest.fn().mockResolvedValue({ putAwayQty: 1 }),
  };
  const returns = { removeToReturnBin: jest.fn().mockResolvedValue({ exited: false }) };
  let controller: ReturnBinController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReturnBinController],
      providers: [
        { provide: ReturnBinService, useValue: returnBins },
        { provide: BoxReturnService, useValue: returns },
      ],
    }).compile();

    controller = module.get(ReturnBinController);
  });

  beforeEach(() => jest.clearAllMocks());

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

  it('mine uses the authenticated actor and requires read permission before the barcode route', async () => {
    await controller.mine('w', { userId: 'u-1' });
    expect(returnBins.mine).toHaveBeenCalledWith('u-1', 'w');
    expect(() => controller.mine('w', undefined)).toThrow(UnauthorizedException);
    expect(Reflect.getMetadata(PATH_METADATA, controller.mine)).toBe('return-bins/mine');
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.mine)).toEqual(['fulfillment.shipment.read']);

    const methods = Object.getOwnPropertyNames(ReturnBinController.prototype);

    expect(methods.indexOf('mine')).toBeLessThan(methods.indexOf('lookup'));
  });

  it.each([undefined, 'RB-1'])('박스에서 빼기는 바구니 %s와 멱등 키를 위임한다', async (returnBinBarcode) => {
    const dto = { barcode: '880', returnBinBarcode, quantity: 1 };

    await controller.removeFromBox('s-1', dto, 'key-1', { userId: 'u-1', roles: [] });
    expect(returns.removeToReturnBin).toHaveBeenCalledWith('s-1', dto, { id: 'u-1', roles: [] }, 'key-1');
  });

  it.each([undefined, 'A-1'])('되돌림 적치는 위치 %s와 멱등 키를 위임한다', async (locationCode) => {
    const dto = { warehouseId: 'w', barcode: '880', locationCode, quantity: 1 };

    await controller.putaway('RB-1', dto, 'key', { userId: 'u-1', roles: [] });
    expect(returnBins.putaway).toHaveBeenCalledWith('RB-1', dto, { id: 'u-1', roles: [] }, 'key');
  });

  it('allows omitted bin and location fields but rejects empty or invalid supplied fields', async () => {
    const removal = Object.assign(new ReturnBinRemovalDto(), { barcode: '880', quantity: 1 });
    const putaway = Object.assign(new ReturnBinPutawayDto(), {
      warehouseId: '762739bb-131f-470a-ad4b-32bf77d51dca',
      barcode: '880',
      quantity: 1,
    });

    expect(await validate(removal)).toEqual([]);
    expect(await validate(putaway)).toEqual([]);

    for (const value of ['', 12]) {
      expect(await validate(Object.assign(removal, { returnBinBarcode: value }))).not.toEqual([]);
      expect(await validate(Object.assign(putaway, { locationCode: value }))).not.toEqual([]);
    }
  });
});
