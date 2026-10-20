import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VacationReminderWheel } from './vacation-reminder-wheel';

it('provides two scroll wheels for a number and minute/hour/day/week without text inputs', () => {
  const html = renderToStaticMarkup(
    createElement(VacationReminderWheel, {
      amount: 30,
      unit: 1,
      onAmountChange: () => {},
      onUnitChange: () => {},
    })
  );

  expect(html.match(/role="listbox"/g)).toHaveLength(2);
  expect(html).toContain('aria-label="알림 숫자"');
  expect(html).toContain('aria-label="알림 단위"');
  for (const label of ['분', '시간', '일', '주']) {
    expect(html).toContain(`>${label}</span>`);
  }

  expect(html).not.toContain('<input');
  expect(html).not.toContain('<select');
});

it('keeps gestures vertical while curving the glyphs around a cylindrical wheel', () => {
  const html = renderToStaticMarkup(
    createElement(VacationReminderWheel, {
      amount: 30,
      unit: 1,
      onAmountChange: () => {},
      onUnitChange: () => {},
    })
  );

  expect(html.match(/overflow-x-hidden/g)).toHaveLength(2);
  expect(html.match(/touch-pan-y/g)).toHaveLength(2);
  expect(html).toContain('perspective(400px)');
  expect(html).toContain('rotateX(');
  expect(html).not.toContain('translateX(');
});

it('renders only nearby wheel options even when the numeric range contains 999 values', () => {
  const html = renderToStaticMarkup(
    createElement(VacationReminderWheel, {
      amount: 500,
      unit: 1,
      onAmountChange: () => {},
      onUnitChange: () => {},
    })
  );

  expect((html.match(/role="option"/g) ?? []).length).toBeLessThanOrEqual(15);
  expect(html.includes('aria-posinset="500"')).toBe(true);
  expect(html.includes('aria-setsize="999"')).toBe(true);
});
