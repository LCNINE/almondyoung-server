import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
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

  it('창고 작업 스코프를 요구한다', () => {
    expect(Reflect.getMetadata('required_scopes', WaybillLabelController.prototype.label)).toEqual([
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
    ]);
  });
});
