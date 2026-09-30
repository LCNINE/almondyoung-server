import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ReportShipmentShortPickDto } from '../dto/shipment-short-pick.dto';
import { ShipmentShortPickService } from './shipment-short-pick.service';

/** 명령 실행 전에 끝나는 판정만 본다 — 트랜잭션 본문(부족 승인·재배정·이탈)은 통합 스펙이 본다. */
describe('ShipmentShortPickService', () => {
  function makeService(scopes = new Set<string>([FULFILLMENT_SCOPE.SHIPMENT_REOPEN])) {
    const commands = { execute: jest.fn() };
    const service = new ShipmentShortPickService(
      commands as never,
      { getScopesByRoles: jest.fn().mockResolvedValue(scopes) } as never,
      { logUserActionRequired: jest.fn() } as never,
      { assertV2MutationAllowed: jest.fn() } as never,
      {} as never,
      {} as never,
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

  it('shipment.reopen 스코프가 없으면 403 — 명령을 실행하지 않는다', async () => {
    const { service, commands } = makeService(new Set());
    await expect(service.report('s', dto, 'k', { id: 'a', roles: [] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(commands.execute).not.toHaveBeenCalled();
  });
});
