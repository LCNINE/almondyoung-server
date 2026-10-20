import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AttendanceBrandSplash,
  scheduleSplashMinimum,
} from './attendance-app-startup';

it('shows a vector clock illustration on ivory without loading copy or a progress indicator', () => {
  const html = renderToStaticMarkup(createElement(AttendanceBrandSplash));

  expect(html).toContain('아몬드영 워크');
  expect(html.includes('<svg')).toBe(true);
  expect(html.includes('<clipPath')).toBe(true);
  expect(html).toContain('attendance-clock-mascot');
  expect(html).not.toContain('<img');
  expect(html).toContain('#FFFBF5');
  expect(html).not.toContain('불러오는');
  expect(html).not.toContain('progressbar');
  expect(html).not.toContain('animate-spin');
});

describe('installed app splash visibility', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps a fast launch visible for 1.5 seconds', () => {
    const onElapsed = jest.fn();
    const cancel = scheduleSplashMinimum(onElapsed);

    jest.advanceTimersByTime(1499);
    expect(onElapsed).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('cancels the timer when the startup layer unmounts', () => {
    const onElapsed = jest.fn();
    const cancel = scheduleSplashMinimum(onElapsed);

    cancel();
    jest.advanceTimersByTime(2000);

    expect(onElapsed).not.toHaveBeenCalled();
  });
});
