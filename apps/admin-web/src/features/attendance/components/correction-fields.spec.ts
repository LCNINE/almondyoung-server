import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CorrectionDateTimeFields,
  correctionTimestamp,
} from './correction-requests';

describe('correction date and time fields', () => {
  it('keeps a date-only draft empty until an actual time is chosen', () => {
    expect(correctionTimestamp('2026-10-20', '', '2026-10-19')).toBe('');
  });

  it('uses the work date when choosing a time before a separate date', () => {
    expect(correctionTimestamp('', '09:15', '2026-10-19')).toBe(
      '2026-10-19T09:15'
    );
  });

  it('preserves a separately chosen next-day checkout date', () => {
    expect(correctionTimestamp('2026-10-20', '02:30', '2026-10-19')).toBe(
      '2026-10-20T02:30'
    );
  });

  it('clears the complete timestamp when the time is cleared', () => {
    expect(correctionTimestamp('2026-10-20', '', '2026-10-19')).toBe('');
  });

  it('renders a separate labeled date and blank cylinder time trigger', () => {
    const html = renderToStaticMarkup(
      createElement(CorrectionDateTimeFields, {
        label: '실제 퇴근',
        value: '',
        fallbackDate: '2026-10-19',
        onChange: () => {},
      })
    );

    expect(html).toContain('실제 퇴근 날짜');
    expect(html).toContain('실제 퇴근 시각');
    expect(html).toContain('type="date"');
    expect(html).not.toContain('datetime-local');
    expect(html).not.toContain('autofocus');
    expect(html).not.toContain('09:00');
  });
});

it('keeps native date controls out of initial focus and bounds their width', () => {
  const html = renderToStaticMarkup(
    createElement(CorrectionDateTimeFields, {
      label: '실제 출근',
      value: '',
      fallbackDate: '2026-10-19',
      onChange: () => {},
    })
  );

  expect(html.includes('tabindex="-1"')).toBe(true);
  expect(html.includes('opacity-0')).toBe(true);
  expect(html.includes('overflow-hidden')).toBe(true);
  expect(html).not.toContain('autofocus');
});
