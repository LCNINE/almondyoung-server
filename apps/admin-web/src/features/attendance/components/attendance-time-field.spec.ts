import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttendanceTimeField } from './attendance-time-field';

it('opens time selection from a floating field without a native time input', () => {
  const html = renderToStaticMarkup(
    createElement(AttendanceTimeField, {
      label: '출근 시각',
      value: '09:30',
      onChange: () => {},
    })
  );

  expect(html).toContain('출근 시각');
  expect(html).toContain('09:30');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('type="time"');
});

it('keeps an optional blank time empty instead of silently choosing the current time', () => {
  const html = renderToStaticMarkup(
    createElement(AttendanceTimeField, {
      label: '실제 퇴근 시각',
      value: '',
      clearable: true,
      onChange: () => {},
    })
  );

  expect(html).toContain('실제 퇴근 시각');
  expect(html).not.toContain('09:00');
  expect(html).not.toContain('autofocus');
});
