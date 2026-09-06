import {
  pickCompositionRoute,
  shouldChangeStrategyForVoid,
  pickDefaultTab,
} from './matching-save-route';

describe('pickCompositionRoute', () => {
  it('routes pending (or unset) matchings to resolve', () => {
    expect(pickCompositionRoute('pending')).toBe('resolve');
    expect(pickCompositionRoute(null)).toBe('resolve');
    expect(pickCompositionRoute(undefined)).toBe('resolve');
  });

  it('routes matched and ignored matchings to upsert', () => {
    expect(pickCompositionRoute('matched')).toBe('upsert');
    expect(pickCompositionRoute('ignored')).toBe('upsert');
  });
});

describe('shouldChangeStrategyForVoid', () => {
  it('is true only for matched', () => {
    expect(shouldChangeStrategyForVoid('matched')).toBe(true);
  });

  it('is false for pending, ignored, null, and undefined', () => {
    expect(shouldChangeStrategyForVoid('pending')).toBe(false);
    expect(shouldChangeStrategyForVoid('ignored')).toBe(false);
    expect(shouldChangeStrategyForVoid(null)).toBe(false);
    expect(shouldChangeStrategyForVoid(undefined)).toBe(false);
  });
});

describe('pickDefaultTab', () => {
  it('defaults matched lines to manual', () => {
    expect(pickDefaultTab('matched')).toBe('manual');
  });

  it('defaults pending, ignored, null, and undefined to auto', () => {
    expect(pickDefaultTab('pending')).toBe('auto');
    expect(pickDefaultTab('ignored')).toBe('auto');
    expect(pickDefaultTab(null)).toBe('auto');
    expect(pickDefaultTab(undefined)).toBe('auto');
  });
});
