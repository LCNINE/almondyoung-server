import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  type AttendanceMe,
  type CalendarLeave,
} from '@packages/domain-types/attendance';
import { SharedCalendar } from './shared-calendar';
import MobileCalendarPage from '../../../app/attendance/calendar/page';

describe('attendance calendar audience and edit controls', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-16T03:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function render(page: ReturnType<typeof createElement>) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const me: AttendanceMe = {
      userId: 'owner',
      name: '김아몬드',
      today: '2026-10-16',
      status: 'before',
      session: null,
      leave: null,
      settings: DEFAULT_ATTENDANCE_SETTINGS,
      worksites: [],
      isMaster: true,
    };
    const leaves: CalendarLeave[] = [
      {
        id: 'own-leave',
        userId: 'owner',
        name: '김아몬드',
        date: '2026-10-16',
        type: 'full',
        start: null,
        end: null,
      },
      {
        id: 'peer-leave',
        userId: 'peer',
        name: '이하늘',
        date: '2026-10-16',
        type: 'am',
        start: '13:00',
        end: '18:00',
      },
    ];

    client.setQueryData(['attendance', 'me'], me);
    client.setQueryData(['attendance', 'calendar', '2026-10'], leaves);

    try {
      return renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, page)
      );
    } finally {
      client.clear();
    }
  }

  it('opens the mobile schedule as personal and provides an explicit colleague-view action', () => {
    const html = render(createElement(MobileCalendarPage));

    expect(html).toContain('내 휴가·반차 일정');
    expect(html).toContain('다른 직원 일정 보기');
    expect(html).toContain('김아몬드');
    expect(html).not.toContain('이하늘');
    expect(html).not.toContain('경리나라');
  });

  it('shows both employees in shared view but exposes edit and delete only for the owner, including masters', () => {
    const html = render(
      createElement(SharedCalendar, { initialScope: 'shared' })
    );

    expect(html).toContain('김아몬드');
    expect(html).toContain('이하늘');
    expect(html.match(/>수정<\/button>/g)).toHaveLength(1);
    expect(html.match(/>삭제<\/button>/g)).toHaveLength(1);
    expect(html).toContain('내 일정만 보기');
    expect(html).not.toContain('경리나라');
  });
});
