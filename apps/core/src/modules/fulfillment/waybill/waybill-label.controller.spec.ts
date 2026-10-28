import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { WaybillLabelController } from './waybill-label.controller';

describe('WaybillLabelController', () => {
  it('label 은 shipmentId 를 서비스에 그대로 넘긴다', async () => {
    const svc = {
      renderLabel: jest.fn().mockResolvedValue({ waybillId: 'w1', trackingNo: 'T', format: 'zpl', data: '^XA^XZ' }),
    };
    const controller = new WaybillLabelController(svc as never);
    await expect(controller.label('s1')).resolves.toMatchObject({ format: 'zpl' });
    expect(svc.renderLabel).toHaveBeenCalledWith('s1');
  });

  it('confirmPrint 는 지문과 행위자를 서비스에 넘긴다', async () => {
    const svc = { confirmPrint: jest.fn().mockResolvedValue({ fingerprint: 'f', revision: 1, printedAt: 't' }) };
    const controller = new WaybillLabelController(svc as never);
    await controller.confirmPrint('s1', { fingerprint: 'f' }, { userId: 'u1' });
    expect(svc.confirmPrint).toHaveBeenCalledWith('s1', 'f', { id: 'u1' });
    expect(() => controller.confirmPrint('s1', { fingerprint: 'f' }, {})).toThrow('Authenticated actor');
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, WaybillLabelController.prototype.confirmPrint)).toEqual([
      'fulfillment.warehouse.operate',
    ]);
  });

  it('출고 조회 권한을 요구한다', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, WaybillLabelController.prototype.label)).toEqual([
      'fulfillment.shipment.read',
    ]);
  });
});
