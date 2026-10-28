import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
/* eslint-disable @typescript-eslint/unbound-method */
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ShipmentTrackingController } from './shipment-tracking.controller';

describe('ShipmentTrackingController authorization contract', () => {
  it('requires the isolated tracking-ingest permission', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ShipmentTrackingController.prototype.record)).toEqual([
      'fulfillment.tracking.ingest',
    ]);
  });

  it('validates dispatchAttemptId with ParseUUIDPipe', () => {
    const routeArgs = Reflect.getMetadata(ROUTE_ARGS_METADATA, ShipmentTrackingController, 'record') as Record<
      string,
      { pipes?: unknown[] }
    >;
    const pipes = Object.values(routeArgs).flatMap((value) => value.pipes ?? []);
    expect(pipes.some((pipe) => pipe?.constructor?.name === 'ParseUUIDPipe')).toBe(true);
  });
});
