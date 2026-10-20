import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VacationPeriodFields } from './vacation-period-fields';

const props = {
  allDay: true,
  from: '2026-10-19',
  to: '2026-10-22',
  startTime: '09:00',
  endTime: '13:00',
  recurrence: { frequency: 'none' as const },
  showDday: false,
  reminderMinutes: [],
  onReminderChange: () => {},
  onAllDayChange: () => {},
  onFromChange: () => {},
  onToChange: () => {},
  onStartTimeChange: () => {},
  onEndTimeChange: () => {},
  onRecurrenceChange: () => {},
  onDdayChange: () => {},
};

it('shows the requested six controls without per-day lists or extra leave fields', () => {
  const html = renderToStaticMarkup(createElement(VacationPeriodFields, props));

  for (const label of ['종일', '시작', '종료', '알림 없음', '반복', '디데이']) {
    expect(html).toContain(label);
  }

  for (const label of [
    '날짜별 조정',
    '휴가 종류',
    '출근 예정',
    '퇴근 예정',
    '추가할 휴가',
  ]) {
    expect(html).not.toContain(label);
  }

  expect(html).not.toContain('type="time"');
  expect(html).not.toContain('autofocus');
});

it('allows both times to be selected when all-day is switched off', () => {
  const html = renderToStaticMarkup(
    createElement(VacationPeriodFields, { ...props, allDay: false })
  );

  expect(html).toContain('aria-label="휴가 시작 시각"');
  expect(html).toContain('aria-label="휴가 종료 시각"');
  expect(html).toContain('09:00');
  expect(html).toContain('13:00');
});

it('makes the reminder row an operable bottom-sheet trigger', () => {
  const html = renderToStaticMarkup(createElement(VacationPeriodFields, props));

  expect(html).toMatch(/<button[^>]*aria-label="휴가 알림 설정: 알림 없음"/);
  expect(html).toContain('aria-haspopup="dialog"');
});

it('shows selected reminders in the editor when reopening a saved vacation', () => {
  const html = renderToStaticMarkup(
    createElement(VacationPeriodFields, {
      ...props,
      reminderMinutes: [10, 60, 1440],
    })
  );

  expect(html).toContain(
    '휴가 알림 설정: 시작 10분 전, 시작 1시간 전, 시작 1일 전'
  );
});

it('keeps start and end time controls available for an all-day vacation', () => {
  const html = renderToStaticMarkup(createElement(VacationPeriodFields, props));

  expect(html).not.toMatch(
    /<button[^>]*aria-label="휴가 시작 시각"[^>]* disabled=""/
  );
  expect(html).not.toMatch(
    /<button[^>]*aria-label="휴가 종료 시각"[^>]* disabled=""/
  );
  expect(html).toContain('시간을 선택하면 종일이 해제돼요.');
});
