import { PERMISSION_CATALOG } from '@app/authorization';
import {
  FULFILLMENT_PERMISSION,
  SHORT_PICK_REPORT_PERMISSIONS,
  SIMPLE_OUTBOUND_FORCE_PERMISSIONS,
} from './fulfillment-permissions';
import { FULFILLMENT_SCOPE } from './fulfillment-scopes';

describe('fulfillment permission keys', () => {
  it('keeps the same strings the scope table registers', () => {
    expect(FULFILLMENT_PERMISSION).toEqual(FULFILLMENT_SCOPE);
  });

  it('names only catalog permissions', () => {
    const catalog = new Set<string>(PERMISSION_CATALOG.map((entry) => entry.key));
    expect(Object.values(FULFILLMENT_PERMISSION).filter((key) => !catalog.has(key))).toEqual([]);
  });

  it('lists the admin key first in each any-of set', () => {
    expect(SHORT_PICK_REPORT_PERMISSIONS).toEqual(['fulfillment.shipment.reopen', 'fulfillment.shipment.short_pick']);
    expect(SIMPLE_OUTBOUND_FORCE_PERMISSIONS).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.station_force',
    ]);
  });
});
