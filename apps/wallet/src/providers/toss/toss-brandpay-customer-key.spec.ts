import { tossBrandPayCustomerKey } from './toss-brandpay-customer-key';

describe('tossBrandPayCustomerKey', () => {
  const originalClientKey = process.env.TOSS_WIDGET_CLIENT_KEY;
  const originalSuffix = process.env.TOSS_WIDGET_TEST_CUSTOMER_KEY_SUFFIX;

  afterEach(() => {
    if (originalClientKey === undefined) delete process.env.TOSS_WIDGET_CLIENT_KEY;
    else process.env.TOSS_WIDGET_CLIENT_KEY = originalClientKey;
    if (originalSuffix === undefined) delete process.env.TOSS_WIDGET_TEST_CUSTOMER_KEY_SUFFIX;
    else process.env.TOSS_WIDGET_TEST_CUSTOMER_KEY_SUFFIX = originalSuffix;
  });

  it('rotates only test widget customer keys when a suffix is configured', () => {
    process.env.TOSS_WIDGET_TEST_CUSTOMER_KEY_SUFFIX = 't3';
    process.env.TOSS_WIDGET_CLIENT_KEY = 'test_gck_example';
    expect(tossBrandPayCustomerKey('user-id')).toBe('user-user-id-t3');

    process.env.TOSS_WIDGET_CLIENT_KEY = 'live_gck_example';
    expect(tossBrandPayCustomerKey('user-id')).toBe('user-user-id');
  });
});
