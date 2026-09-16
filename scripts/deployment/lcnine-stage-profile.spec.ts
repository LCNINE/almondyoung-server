import { DEMO_ACTIVE_SERVICE_DATABASES, getLcnineStageProfile } from '../../deployments/lcnine/stage-profile';

describe('lcnine deployment stage profile', () => {
  it.each([
    ['live', 'admin.almondyoung.com', 'https://admin.almondyoung.com'],
    ['dev', 'admin.dev.lcnine-dev.com', 'https://admin.dev.lcnine-dev.com'],
    ['preview-42', 'admin.dev.lcnine-dev.com', 'https://admin.dev.lcnine-dev.com'],
    ['demo', 'admin.almondyoung-next.com', 'https://admin.almondyoung-next.com'],
  ])('resolves %s without changing existing domain defaults', (stage, hostname, url) => {
    const profile = getLcnineStageProfile(stage);

    expect(profile.domain('admin')).toBe(hostname);
    expect(profile.url('admin')).toBe(url);
  });

  it('keeps live retained and protected', () => {
    const profile = getLcnineStageProfile('live');

    expect(profile.removal).toBe('retain');
    expect(profile.protect).toBe(true);
  });

  it('keeps existing non-live stages removable and unprotected', () => {
    const profile = getLcnineStageProfile('dev');

    expect(profile.removal).toBe('remove');
    expect(profile.protect).toBe(false);
  });

  it('protects demo state while retaining removable resource policies', () => {
    const profile = getLcnineStageProfile('demo');

    expect(profile.removal).toBe('remove');
    expect(profile.protect).toBe(true);
  });

  it('selects only the demo logistics services and omits commerce/search caches', () => {
    const profile = getLcnineStageProfile('demo');

    expect(profile.services).toEqual([
      'core',
      'analytics',
      'channel-adapter',
      'notification',
      'file-service',
      'admin-web',
    ]);
    expect(DEMO_ACTIVE_SERVICE_DATABASES).toEqual([
      'core',
      'analytics',
      'channel_adapter',
      'notification',
      'file_service',
    ]);
    expect(profile.resources).toEqual({ redis: false, openSearch: false });
  });

  it('preserves the full resource graph for live and existing non-live stages', () => {
    expect(getLcnineStageProfile('live').resources).toEqual({ redis: true, openSearch: true });
    expect(getLcnineStageProfile('dev').resources).toEqual({ redis: true, openSearch: true });
  });

  it('provides the fail-closed demo runtime contract', () => {
    expect(getLcnineStageProfile('demo').environment).toEqual({
      APP_STAGE: 'demo',
      DEMO_CONSOLE_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_MODE: 'mock',
    });
  });
});
