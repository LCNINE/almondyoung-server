import { checkpointEvaluations, createCheckpointsForTesting, PermissionCheckpoints } from '@app/authorization';
import { register } from 'prom-client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportShipmentShortPickDto } from '../dto/shipment-short-pick.dto';
import { ShipmentShortPickService } from './shipment-short-pick.service';

/** 명령 실행 전에 끝나는 판정만 본다 — 트랜잭션 본문(부족 승인·재배정·이탈)은 통합 스펙이 본다. */
describe('ShipmentShortPickService', () => {
  function makeService(checkpoints: PermissionCheckpoints = createCheckpointsForTesting()) {
    const commands = { execute: jest.fn() };
    const service = new ShipmentShortPickService(
      commands as never,
      { logUserActionRequired: jest.fn() } as never,
      { assertV2MutationAllowed: jest.fn() } as never,
      {} as never,
      {} as never,
      checkpoints,
    );
    return { service, commands };
  }

  const dto: ReportShipmentShortPickDto = {
    workItemId: '22222222-2222-4222-8222-222222222222',
    expectedWorkItemLeaseVersion: 1,
    sessionId: '44444444-4444-4444-8444-444444444444',
    expectedSessionVersion: 1,
    expectedManifestVersion: 1,
    lines: [
      {
        shipmentLineId: '55555555-5555-4555-8555-555555555555',
        sourceLocationId: '66666666-6666-4666-8666-666666666666',
        expectedLineVersion: 1,
        shortQty: 1,
      },
    ],
    reason: 'inventory_shortage',
  };

  it('지원하지 않는 사유는 400 — 명령을 실행하지 않는다', async () => {
    const { service, commands } = makeService();
    await expect(
      service.report('s', { ...dto, reason: 'nope' as never }, 'k', { id: 'a', roles: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('reopen·short_pick 권한이 둘 다 없으면 403 — 명령을 실행하지 않는다', async () => {
    const { service, commands } = makeService(createCheckpointsForTesting({ logistics_worker: [] }));
    const report = service.report('s', dto, 'k', { id: 'a', roles: ['logistics_worker'] });
    await expect(report).rejects.toBeInstanceOf(ForbiddenException);
    await expect(report).rejects.toThrow(
      'Missing required permission: fulfillment.shipment.reopen or fulfillment.shipment.short_pick',
    );
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('역할이 없으면 403', async () => {
    const { service, commands } = makeService();
    await expect(service.report('s', dto, 'k', { id: 'a', roles: [] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('결품 권한(short_pick)만 있어도 명령을 실행한다', async () => {
    register.resetMetrics();
    const { service, commands } = makeService(
      createCheckpointsForTesting({ logistics_worker: ['fulfillment.shipment.short_pick'] }),
    );
    await service.report('s', dto, 'k', { id: 'a', roles: ['logistics_worker'] });
    expect(commands.execute).toHaveBeenCalledTimes(1);
    expect(await checkpointEvaluations('fulfillment.short_pick_report', 'match')).toBe(1);
  });

  it('재개방 권한(reopen)만 있어도 명령을 실행한다', async () => {
    const { service, commands } = makeService(
      createCheckpointsForTesting({ logistics_manager: ['fulfillment.shipment.reopen'] }),
    );
    await service.report('s', dto, 'k', { id: 'a', roles: ['logistics_manager'] });
    expect(commands.execute).toHaveBeenCalledTimes(1);
  });

  it('실제 첫 부여 표의 물류 작업자는 통과한다', async () => {
    const { service, commands } = makeService();
    await service.report('s', dto, 'k', { id: 'a', roles: ['logistics_worker'] });
    expect(commands.execute).toHaveBeenCalledTimes(1);
  });
});
