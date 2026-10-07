import {
  defaultTimeSaleSettings,
  validateTimeSaleSettings,
  nextRepeatedPeriod,
} from '../../../../../packages/domain-types/time-sale';

describe('time-sale settings trust boundary', () => {
  it('rejects executable CSS, invalid image sizes and multiple product containers', () => {
    const settings = defaultTimeSaleSettings();
    settings.environment.imageSize = 0;
    expect(() => validateTimeSaleSettings(settings)).toThrow();
    settings.environment.imageSize = 100;
    settings.styles.main.mobile.components.push({
      ...settings.styles.main.mobile.components[0],
      id: 'unsafe',
      css: { backgroundImage: 'url(javascript:alert(1))' },
    });
    expect(() => validateTimeSaleSettings(settings)).toThrow();
  });
  it('advances repeats across missed cycles and stops at the repeat deadline', () => {
    expect(
      nextRepeatedPeriod('2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z', 24, null, Date.parse('2026-10-09T02:00:00Z')),
    ).toEqual({ startsAt: '2026-10-10T00:00:00.000Z', endsAt: '2026-10-10T01:00:00.000Z' });
    expect(
      nextRepeatedPeriod(
        '2026-10-07T00:00:00Z',
        '2026-10-07T01:00:00Z',
        24,
        '2026-10-09T00:30:00Z',
        Date.parse('2026-10-09T02:00:00Z'),
      ),
    ).toBeNull();
  });
});
