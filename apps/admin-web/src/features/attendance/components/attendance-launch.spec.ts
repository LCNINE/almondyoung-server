import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  type AttendanceMe,
} from '@packages/domain-types/attendance';
import AttendancePage from '../../../app/attendance/page';
import manifest from '../../../app/attendance/manifest';
import {
  ATTENDANCE_MANAGER_PERMISSIONS,
  seedPermissions,
} from '../testing/seed-permissions';

describe('attendance PWA entry', () => {
  it.each([false, true])(
    'shows request review only with the review permission (granted=%s)',
    (granted) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      });
      const me: AttendanceMe = {
        userId: 'owner',
        name: '김아몬드',
        today: '2026-10-19',
        status: 'before',
        session: null,
        leave: null,
        settings: DEFAULT_ATTENDANCE_SETTINGS,
        // 옛 표식은 권한과 반대로 둔다 — 화면은 권한만 본다.
        isMaster: !granted,
        worksites: [
          {
            id: 'site',
            name: '본사',
            latitude: 37.5,
            longitude: 127,
            radiusMeters: 150,
            accuracyMeters: 50,
            active: true,
            version: 1,
          },
        ],
      };

      client.setQueryData(['attendance', 'me'], me);
      seedPermissions(
        client,
        granted ? ATTENDANCE_MANAGER_PERMISSIONS : ['attendance.own.write']
      );

      try {
        const entry = manifest().start_url;

        expect(entry).toBe('/attendance');

        const html = renderToStaticMarkup(
          createElement(
            QueryClientProvider,
            { client },
            createElement(AttendancePage)
          )
        );

        expect(html.includes('href="/attendance/review"')).toBe(granted);
        expect(html.includes('href="/attendance/statistics"')).toBe(granted);
        expect(html).toContain('오늘의 근무');
        expect(html).toContain('출근하기');
        expect(html).not.toContain('출근음 테스트');
        expect(html).not.toContain('퇴근음 테스트');
        expect(html).toContain('김아몬드');
        expect(html).not.toContain('오늘도 반가워요.');
        expect(html).not.toContain('홈 화면에 추가하면');
        expect(html).not.toContain('직원 근무 현황 보기');
        expect(html).not.toContain('모바일 출결 페이지 열기');
      } finally {
        client.clear();
      }
    }
  );
});
