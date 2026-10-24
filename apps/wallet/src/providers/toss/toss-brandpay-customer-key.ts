export function tossBrandPayCustomerKey(userId: string): string {
  const suffix = process.env.TOSS_WIDGET_TEST_CUSTOMER_KEY_SUFFIX;
  const testWidget = process.env.TOSS_WIDGET_CLIENT_KEY?.startsWith('test_gck_');
  return `user-${userId}${testWidget && suffix ? `-${suffix}` : ''}`;
}
