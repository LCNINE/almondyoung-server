import { computePartialReservationQuantity } from './shipment-reservation.service';

describe('ShipmentReservationService allocation policy', () => {
  it('reserves only the currently available part of a shipment-line shortage', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 10,
        outstandingQty: 10,
        availableQty: 6,
      }),
    ).toBe(6);
  });

  it('caps a retry increment by the remaining line shortage', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 10,
        outstandingQty: 4,
        availableQty: 20,
      }),
    ).toBe(4);
  });

  it('returns zero when no stock is currently reservable', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 2,
        outstandingQty: 4,
        availableQty: 0,
      }),
    ).toBe(0);
  });

  it('never returns a negative quantity for an already-filled line', () => {
    expect(
      computePartialReservationQuantity({
        requestedQty: 2,
        outstandingQty: 0,
        availableQty: 10,
      }),
    ).toBe(0);
  });
});
