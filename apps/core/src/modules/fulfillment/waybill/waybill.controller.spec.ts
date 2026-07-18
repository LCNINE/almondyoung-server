import { UnauthorizedException } from '@nestjs/common';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { WaybillController } from './waybill.controller';

describe('WaybillController', () => {
  function make() {
    const svc = {
      issueForShipment: jest.fn().mockResolvedValue({ id: 'w1', status: 'registered' }),
      registerManual: jest.fn().mockResolvedValue({ id: 'w1', status: 'registered' }),
      void: jest.fn().mockResolvedValue({ id: 'w1', status: 'voided' }),
      reissue: jest.fn().mockResolvedValue({ id: 'w2', status: 'registered' }),
      getActiveWaybill: jest.fn().mockResolvedValue({ id: 'w1', status: 'registered' }),
      issueBatch: jest
        .fn()
        .mockResolvedValue([{ shipmentId: 's1', status: 'registered', trackingNo: 'T1', reason: null }]),
    };
    const controller = new WaybillController(svc as never);
    return { controller, svc };
  }

  const user = { userId: 'u1', roles: ['logistics_worker'] };

  it('issue delegates with actor + idempotency-key', async () => {
    const { controller, svc } = make();
    await controller.issue('s1', { carrier: 'HANJIN', expectedManifestVersion: 2 } as never, 'idem-1', user);
    expect(svc.issueForShipment).toHaveBeenCalledWith(
      's1',
      { carrier: 'HANJIN', expectedManifestVersion: 2 },
      'idem-1',
      { id: 'u1', roles: ['logistics_worker'] },
    );
  });

  it('passes empty string when idempotency-key header absent', async () => {
    const { controller, svc } = make();
    await controller.issue('s1', { carrier: 'HANJIN', expectedManifestVersion: 2 } as never, undefined, user);
    expect(svc.issueForShipment).toHaveBeenLastCalledWith('s1', expect.anything(), '', expect.anything());
  });

  it('manual delegates the raw dto with actor + idempotency-key', async () => {
    const { controller, svc } = make();
    const dto = { carrier: 'HANJIN', trackingNo: 'T-1', expectedManifestVersion: 1 } as never;
    await controller.manual('s1', dto, 'idem-2', user);
    expect(svc.registerManual).toHaveBeenCalledWith('s1', dto, 'idem-2', { id: 'u1', roles: ['logistics_worker'] });
  });

  it('batch delegates shipmentIds + carrier only (no expectedManifestVersion)', async () => {
    const { controller, svc } = make();
    const dto = { shipmentIds: ['s1', 's2'], carrier: 'HANJIN' } as never;
    await controller.batch(dto, 'idem-3', user);
    expect(svc.issueBatch).toHaveBeenCalledWith(['s1', 's2'], { carrier: 'HANJIN' }, 'idem-3', {
      id: 'u1',
      roles: ['logistics_worker'],
    });
  });

  it('void delegates with actor + idempotency-key', async () => {
    const { controller, svc } = make();
    const dto = { reason: 'damaged' };
    await controller.void('w1', dto, 'idem-4', user);
    expect(svc.void).toHaveBeenCalledWith('w1', dto, 'idem-4', { id: 'u1', roles: ['logistics_worker'] });
  });

  it('reissue delegates with actor + idempotency-key', async () => {
    const { controller, svc } = make();
    await controller.reissue('s1', { carrier: 'HANJIN', expectedManifestVersion: 3 } as never, 'idem-5', user);
    expect(svc.reissue).toHaveBeenCalledWith('s1', { carrier: 'HANJIN', expectedManifestVersion: 3 }, 'idem-5', {
      id: 'u1',
      roles: ['logistics_worker'],
    });
  });

  it('active delegates to getActiveWaybill by shipmentId', async () => {
    const { controller, svc } = make();
    await controller.active('s1');
    expect(svc.getActiveWaybill).toHaveBeenCalledWith('s1');
  });

  it('throws Unauthorized without an actor id', () => {
    const { controller } = make();
    expect(() => controller['actor']({})).toThrow(UnauthorizedException);
  });

  it('requires the expected scopes per route', () => {
    const metadata = (method: (...args: never[]) => unknown) => Reflect.getMetadata('required_scopes', method);

    expect(metadata(WaybillController.prototype.issue)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata(WaybillController.prototype.manual)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata(WaybillController.prototype.batch)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata(WaybillController.prototype.void)).toEqual([FULFILLMENT_SCOPE.SHIPMENT_REOPEN]);
    expect(metadata(WaybillController.prototype.reissue)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata(WaybillController.prototype.active)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
  });
});
