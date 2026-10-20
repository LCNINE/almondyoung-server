import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AttendanceStatistics } from './attendance-statistics';
import { StatisticsPeople } from './statistics-people';
import {
  ATTENDANCE_MANAGER_PERMISSIONS,
  failPermissions,
  seedPermissions,
} from '../testing/seed-permissions';

it.each([false, true])(
  'limits monthly statistics to the statistics permission (granted=%s)',
  (granted) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    client.setQueryData(['attendance', 'me'], {
      userId: 'owner',
      isMaster: !granted,
    });
    seedPermissions(
      client,
      granted ? ATTENDANCE_MANAGER_PERMISSIONS : ['attendance.own.write']
    );
    client.setQueryData(['attendance', 'statistics', '2026-10'], {
      month: '2026-10',
      totals: {
        employeeCount: 1,
        recordedDays: 3,
        completedDays: 2,
        recordedMinutes: 780,
        missingCheckoutDays: 1,
        ongoingDays: 0,
      },
      people: [
        {
          userId: 'owner',
          name: '김아몬드',
          recordedDays: 3,
          completedDays: 2,
          recordedMinutes: 780,
          missingCheckoutDays: 1,
          ongoingDays: 0,
        },
      ],
    });

    try {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(AttendanceStatistics, { initialMonth: '2026-10' })
        )
      );

      if (granted) {
        expect(html).toContain('김아몬드');
        expect(html).toContain('13시간');
        expect(html).toContain('퇴근 미기록');
        expect(html).toContain('직원 이름 검색');
      } else {
        expect(html).toContain('권한이 없어요');
        expect(html).not.toContain('김아몬드');
        expect(html).not.toContain('13시간');
      }
    } finally {
      client.clear();
    }
  }
);

it.each(['loading', 'error'] as const)(
  'does not call an unchecked permission a refusal (%s)',
  async (state) => {
    const client = new QueryClient({
      // 실패한 조회를 화면이 처음 그릴 때 다시 시도하면 «확인 중»으로 돌아간다 — 실패 상태 그대로 그린다.
      defaultOptions: {
        queries: { retry: false, retryOnMount: false, gcTime: Infinity },
      },
    });

    // 옛 표식이 열어 주더라도 권한을 확인하기 전에는 통계를 그리지 않는다.
    client.setQueryData(['attendance', 'me'], {
      userId: 'owner',
      isMaster: true,
    });

    if (state === 'error') {
      await failPermissions(client);
    }

    try {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(AttendanceStatistics, { initialMonth: '2026-10' })
        )
      );

      expect(html).not.toContain('권한이 없어요');
      expect(html).not.toContain('직원 이름 검색');
      expect(html).toContain(
        state === 'error'
          ? '권한 정보를 불러오지 못했어요'
          : '권한을 확인하고 있어요'
      );
    } finally {
      client.clear();
    }
  }
);

it('renders only ten employees and exposes all five pages for 41 staff', () => {
  const people = Array.from({ length: 41 }, (_, index) => ({
    userId: `person-${index + 1}`,
    name: `샘플 직원 ${String(index + 1).padStart(2, '0')}`,
    recordedDays: 10,
    completedDays: 10,
    recordedMinutes: 4800,
    missingCheckoutDays: 0,
    ongoingDays: 0,
  }));
  const html = renderToStaticMarkup(
    createElement(StatisticsPeople, { people, pending: false })
  );

  expect(html).toContain('샘플 직원 01');
  expect(html).toContain('샘플 직원 10');
  expect(html).not.toContain('샘플 직원 11');
  expect(html).toContain('aria-label="5페이지"');
  expect(html).toContain('aria-current="page"');
});
