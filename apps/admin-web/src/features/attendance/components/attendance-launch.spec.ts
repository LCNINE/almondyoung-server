import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  type AttendanceMe,
} from '@packages/domain-types/attendance';
import AttendancePage from '../../../app/attendance/page';
import manifest from '../../../app/attendance/manifest';

describe('attendance PWA entry', () => {
  it.each([false, true])(
    'shows request review only for a master (master=%s)',
    (isMaster) => {
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
        isMaster,
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

        expect(html.includes('href="/attendance/review"')).toBe(isMaster);
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
