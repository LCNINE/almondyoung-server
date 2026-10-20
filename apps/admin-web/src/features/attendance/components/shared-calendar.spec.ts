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
import {
  ATTENDANCE_MANAGER_PERMISSIONS,
  seedPermissions,
} from '../testing/seed-permissions';

describe('attendance calendar audience and edit controls', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-16T03:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function render(
    page: ReturnType<typeof createElement>,
    additionalLeaves: CalendarLeave[] = []
  ) {
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
      // 옛 표식은 반대로 둔다 — 화면은 권한만 본다.
      isMaster: false,
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
      ...additionalLeaves,
    ];

    client.setQueryData(['attendance', 'me'], me);
    seedPermissions(client, ATTENDANCE_MANAGER_PERMISSIONS);
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

    expect(html).toContain('휴가·반차 일정');
    expect(html).toContain('다른 직원 일정 보기');
    expect(html).toContain('김아몬드');
    expect(html).not.toContain('이하늘');
    expect(html).not.toContain('경리나라');
  });

  it('shows both employees in shared view and keeps day details out of the month view', () => {
    const html = render(
      createElement(SharedCalendar, { initialScope: 'shared' })
    );

    expect(html).toContain('김아몬드');
    expect(html).toContain('이하늘');
    expect(html).not.toContain('>수정</button>');
    expect(html).not.toContain('>삭제</button>');
    expect(html).toContain('aria-label="2026-10-16 내 휴가·반차 등록"');
    expect(html).toContain('좌우로 밀어 월을 넘기고');
    expect(html).toContain('내 일정만 보기');
    expect(html).not.toContain('경리나라');
  });

  it('provides a distinct accessible action to open the complete list when a day exceeds three staff', () => {
    const html = render(
      createElement(SharedCalendar, { initialScope: 'shared' }),
      [
        {
          id: 'third',
          userId: 'third',
          name: '오하린',
          date: '2026-10-16',
          type: 'full',
          start: null,
          end: null,
        },
        {
          id: 'fourth',
          userId: 'fourth',
          name: '박봄',
          date: '2026-10-16',
          type: 'full',
          start: null,
          end: null,
        },
      ]
    );

    expect(html).toContain('aria-label="2026-10-16 전체 일정 4명 보기"');
    expect(html).toContain('+1명 더 보기');
  });
});
