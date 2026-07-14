import { ValidationPipe } from '@nestjs/common';
import { SplitShipmentDto } from '../dto/shipment-planning.dto';
import { ShipmentPlanningController } from '../controllers/shipment-planning.controller';
import { canonicalFulfillmentRequestHash } from './fulfillment-command.service';
import { confirmedReservationReleaseForCancellation, ShipmentPlanningService } from './shipment-planning.service';

function planningHarness() {
  const execute = jest.fn((input: { canonicalRequest: unknown }) => Promise.resolve(input.canonicalRequest));
  const service = new ShipmentPlanningService(
    {} as never,
    { execute } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertV2MutationAllowed: jest.fn() } as never,
  );
  return { service, execute };
}

describe('ShipmentPlanningService command boundary', () => {
  const actor = { id: 'operator-from-jwt', roles: ['warehouse_operator'] };
  const firstLineId = '00000000-0000-4000-8000-000000000001';
  const secondLineId = '00000000-0000-4000-8000-000000000002';

  it('cancels unreserved quantity before releasing confirmed reservations', () => {
    expect(confirmedReservationReleaseForCancellation(10, 6, 4)).toBe(0);
    expect(confirmedReservationReleaseForCancellation(10, 6, 6)).toBe(2);
    expect(confirmedReservationReleaseForCancellation(10, 10, 4)).toBe(4);
  });

  it('normalizes split moves before hashing so client array order is immaterial', async () => {
    const first = planningHarness();
    const second = planningHarness();
    const base = { expectedManifestVersion: 1, reason: 'backorder split' };

    const firstRequest = await first.service.split(
      'shipment-1',
      {
        ...base,
        moves: [
          { shipmentLineId: secondLineId, expectedLineVersion: 1, qty: 2 },
          { shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 },
        ],
      },
      'split-key',
      actor,
    );
    const secondRequest = await second.service.split(
      'shipment-1',
      {
        ...base,
        moves: [
          { shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 },
          { shipmentLineId: secondLineId, expectedLineVersion: 1, qty: 2 },
        ],
      },
      'split-key',
      actor,
    );

    expect(canonicalFulfillmentRequestHash(firstRequest)).toBe(canonicalFulfillmentRequestHash(secondRequest));
    expect(
      (firstRequest as { moves: Array<{ shipmentLineId: string }> }).moves.map((move) => move.shipmentLineId),
    ).toEqual([firstLineId, secondLineId]);
  });

  it('normalizes cancellation lines before hashing', async () => {
    const first = planningHarness();
    const second = planningHarness();
    const base = { expectedManifestVersion: 1, reason: 'cancel remainder' };
    const reverse = [
      { shipmentLineId: secondLineId, expectedLineVersion: 1, qty: 2 },
      { shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 },
    ];
    const forward = [...reverse].reverse();

    const firstRequest = await first.service.cancelOutstanding(
      'shipment-1',
      { ...base, lines: reverse },
      'cancel-key',
      actor,
    );
    const secondRequest = await second.service.cancelOutstanding(
      'shipment-1',
      { ...base, lines: forward },
      'cancel-key',
      actor,
    );

    expect(canonicalFulfillmentRequestHash(firstRequest)).toBe(canonicalFulfillmentRequestHash(secondRequest));
  });

  it('takes the operator identity from JWT and strips a forged body operator field', async () => {
    const planning = { split: jest.fn().mockResolvedValue({}) };
    const controller = new ShipmentPlanningController(planning as never);
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const dto = (await pipe.transform(
      {
        expectedManifestVersion: 1,
        reason: 'split',
        operatorId: 'forged-operator',
        moves: [{ shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 }],
      },
      { type: 'body', metatype: SplitShipmentDto },
    )) as SplitShipmentDto;

    await controller.split('shipment-1', dto, 'split-key', {
      userId: 'jwt-operator',
      roles: ['warehouse_operator'],
    });

    expect(dto).not.toHaveProperty('operatorId');
    expect(planning.split).toHaveBeenCalledWith('shipment-1', dto, 'split-key', {
      id: 'jwt-operator',
      roles: ['warehouse_operator'],
    });
  });

  it('rejects a blank reason even when called outside HTTP validation', async () => {
    const { service, execute } = planningHarness();
    await expect(
      service.split(
        'shipment-1',
        {
          expectedManifestVersion: 1,
          reason: '   ',
          moves: [{ shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 }],
        },
        'split-key',
        actor,
      ),
    ).rejects.toThrow('reason must be a non-blank string');
    expect(execute).not.toHaveBeenCalled();
  });
});
