import { cancelShippingFeeBearer } from '../shipping-fee-bearer';

describe('cancelShippingFeeBearer', () => {
  it.each([
    [{ requestedBy: 'customer', reasonCode: 'CHANGE_OF_MIND' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'WRONG_ORDER' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'FOUND_CHEAPER' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'OTHER' }, 'customer'],
    [{ requestedBy: 'customer' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'DELAY' }, 'seller'],
    [{ requestedBy: 'operator', reasonCode: 'CUSTOMER_REQUEST' }, 'customer'],
    [{ requestedBy: 'operator', reasonCode: 'OUT_OF_STOCK' }, 'seller'],
    [{ requestedBy: 'operator', reasonCode: 'ADMIN_REQUEST' }, 'seller'],
    [{ requestedBy: 'operator', reasonCode: 'OTHER' }, 'seller'],
    [{ requestedBy: 'operator' }, 'seller'],
    [{ requestedBy: 'wallet-refund-approval', reasonCode: 'CUSTOMER_REFUND_REQUEST' }, 'seller'],
    [{}, 'seller'],
  ])('%j → %s', (input, expected) => expect(cancelShippingFeeBearer(input)).toBe(expected));
});
