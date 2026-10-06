import { usesTossWidget } from './toss-widget-mode';

describe('usesTossWidget', () => {
  it('identifies widget charges from the stored checkout action', () => {
    expect(usesTossWidget({ nextAction: { type: 'TOSS_CHECKOUT', checkoutMode: 'WIDGET' } })).toBe(true);
    expect(usesTossWidget({ nextAction: { type: 'TOSS_CHECKOUT' } })).toBe(false);
    expect(usesTossWidget(null)).toBe(false);
  });
});
