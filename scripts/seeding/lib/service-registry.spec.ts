import { getServiceRegistry } from './service-registry';

describe('getServiceRegistry demo selection', () => {
  it('keeps the existing lcnine services registry outside demo', () => {
    expect(getServiceRegistry('lcnine-services', 'dev').map((service) => service.name)).toEqual([
      'core',
      'ai',
      'analytics',
      'channel-adapter',
      'membership',
      'notification',
      'ugc-service',
      'search',
      'wallet',
      'file-service',
      'medusa',
    ]);
  });

  it('bootstraps and migrates only active demo services', () => {
    expect(getServiceRegistry('lcnine-services', 'demo').map((service) => service.name)).toEqual([
      'core',
      'analytics',
      'channel-adapter',
      'notification',
      'file-service',
    ]);
  });

  it('keeps the demo auth database isolated in its auth deployment', () => {
    expect(getServiceRegistry('lcnine-auth', 'demo').map((service) => service.name)).toEqual(['user-service']);
  });
});
