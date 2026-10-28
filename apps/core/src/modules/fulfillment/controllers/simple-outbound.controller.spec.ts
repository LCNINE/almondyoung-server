import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  getPermissionDecision,
  recordPermissionDecisions,
  REQUIRED_PERMISSIONS_KEY,
  createCheckpointsForTesting,
} from '@app/authorization';
import { SimpleOutboundController } from './simple-outbound.controller';

describe('SimpleOutboundController', () => {
  const state = {
    shipmentId: 's-1',
    workItemStatus: 'picking',
    status: 'in_progress',
    dispatchAttemptId: null,
    lines: [],
  };

  function build() {
    const service = { scan: jest.fn().mockResolvedValue(state), forceComplete: jest.fn().mockResolvedValue(state) };
    const reader = { byTrackingNo: jest.fn().mockResolvedValue({ shipmentId: 's-1' }) };
    return {
      service,
      reader,
      controller: new SimpleOutboundController(service as never, reader as never, createCheckpointsForTesting()),
    };
  }

  // 라우트 가드(PermissionGuard)가 그 요청이 받은 권한에 대해 남기는 낙인과 같은 것을 남긴다.
  function requestAuthorizedForForce(granted: string = 'fulfillment.dispatch.force'): object {
    const request = {};
    recordPermissionDecisions(request, [granted]);
    return request;
  }

  it('스캔은 actor·idempotencyKey 를 채워 서비스에 위임한다', async () => {
    const { service, controller } = build();
    await controller.scan('s-1', { barcode: '8801', quantity: 2 }, 'key-1', { userId: 'u-1', roles: ['warehouse'] });
    expect(service.scan).toHaveBeenCalledWith('s-1', {
      barcode: '8801',
      quantity: 2,
      actor: { id: 'u-1', roles: ['warehouse'] },
      idempotencyKey: 'key-1',
    });
  });

  it('Idempotency-Key 가 없으면 400 이다', async () => {
    const { controller } = build();
    await expect(
      controller.scan('s-1', { barcode: '8801', quantity: 1 }, undefined, { userId: 'u-1', roles: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('인증 주체가 없으면 401 이다', async () => {
    const { controller } = build();
    await expect(controller.scan('s-1', { barcode: '8801', quantity: 1 }, 'key-1', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('trackingNo 없이 조회하면 400 이다', async () => {
    const { controller } = build();
    await expect(controller.byWaybill('')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('byWaybill 은 trackingNo 로 reader 에 위임하고 결과를 그대로 반환한다', async () => {
    const { reader, controller } = build();
    const result = await controller.byWaybill('T-1');
    expect(reader.byTrackingNo).toHaveBeenCalledWith('T-1');
    expect(result).toEqual({ shipmentId: 's-1' });
  });

  it('강제완료는 authorization decision 을 재구현 없이 원본 그대로 서비스에 전달한다', async () => {
    const { service, controller } = build();
    const request = requestAuthorizedForForce();
    const decision = getPermissionDecision(request, 'fulfillment.dispatch.force');

    await controller.force(
      's-1',
      { reason: 'verified physically' },
      'key-1',
      { userId: 'u-1', roles: ['warehouse_dispatcher'] },
      request,
    );

    expect(service.forceComplete).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({
        reason: 'verified physically',
        actor: { id: 'u-1', roles: ['warehouse_dispatcher'] },
        idempotencyKey: 'key-1',
        authorization: expect.objectContaining({ permission: 'fulfillment.dispatch.force', granted: true }),
      }),
    );
    // Exact identity, not just shape — proves the controller forwards the request's own decision
    // rather than re-deriving/reconstructing one.
    expect(service.forceComplete.mock.calls[0][1].authorization).toBe(decision);
  });

  it('강제완료 라우트는 관리자 또는 스테이션 강제출고 권한을 요구한다', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, SimpleOutboundController.prototype.force)).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.station_force',
    ]);
  });

  it('스테이션 작업자의 강제완료는 station 판정을 그대로 서비스에 넘긴다', async () => {
    const { service, controller } = build();
    const request = requestAuthorizedForForce('fulfillment.dispatch.station_force');

    await controller.force(
      's-1',
      { reason: 'station_force_command' },
      'key-2',
      { userId: 'u-2', roles: ['logistics_worker'] },
      request,
    );

    expect(service.forceComplete.mock.calls[0][1].authorization).toBe(
      getPermissionDecision(request, 'fulfillment.dispatch.station_force'),
    );
  });
});
