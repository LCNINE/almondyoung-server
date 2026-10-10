import { usesTossWidget, usesCustomBrandPay } from './toss-widget-mode';

describe('usesTossWidget', () => {
  it('identifies widget charges from the stored checkout action', () => {
    expect(usesTossWidget({ nextAction: { type: 'TOSS_CHECKOUT', checkoutMode: 'WIDGET' } })).toBe(true);
    expect(usesTossWidget({ nextAction: { type: 'TOSS_CHECKOUT' } })).toBe(false);
    expect(usesTossWidget(null)).toBe(false);
  });
  it('keeps the custom BrandPay merchant key for staged and completed charges', () => {
    const nextAction = { checkoutMode: 'CUSTOM' };
    expect(usesCustomBrandPay({ nextAction, stagedApproval: { paymentType: 'BRANDPAY' } })).toBe(true);
    expect(usesCustomBrandPay({ nextAction, paymentType: 'BRANDPAY' })).toBe(true);
    expect(usesCustomBrandPay({ nextAction, paymentType: 'NORMAL' })).toBe(false);
    expect(usesCustomBrandPay({ nextAction: { checkoutMode: 'WIDGET' }, paymentType: 'BRANDPAY' })).toBe(false);
  });
});
