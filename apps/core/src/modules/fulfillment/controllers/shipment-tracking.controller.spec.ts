/* eslint-disable @typescript-eslint/unbound-method */
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ShipmentTrackingController } from './shipment-tracking.controller';

describe('ShipmentTrackingController authorization contract', () => {
  it('requires the isolated tracking-ingest scope', () => {
    expect(Reflect.getMetadata('required_scopes', ShipmentTrackingController.prototype.record)).toEqual([
      FULFILLMENT_SCOPE.TRACKING_INGEST,
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
