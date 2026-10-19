import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_ATTENDANCE_SETTINGS } from '@packages/domain-types/attendance';
import { WorksiteSettings } from './attendance-settings';

it('shows multiple worksites as summaries without expanding their registration forms', () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const sites = ['본사', '물류센터'].map((name, index) => ({
    id: `site-${index}`,
    name,
    address: `서울 중구 세종대로 ${110 + index}`,
    latitude: 37.5666,
    longitude: 126.9784,
    radiusMeters: 300,
    accuracyMeters: 100,
    active: index === 0,
    version: 1,
  }));

  client.setQueryData(['attendance', 'me'], {
    userId: 'owner',
    name: '테스트 관리자',
    today: '2026-10-19',
    status: 'before',
    session: null,
    leave: null,
    settings: DEFAULT_ATTENDANCE_SETTINGS,
    worksites: sites,
    isMaster: true,
  });
  client.setQueryData(['attendance', 'worksites'], sites);

  try {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WorksiteSettings)
      )
    );

    expect(html).toContain('등록 2곳 · 사용 중 1곳');
    expect(html).toContain('본사 수정');
    expect(html).toContain('물류센터 수정');
    expect(html).toContain('서울 중구 세종대로 110');
    expect(html).toContain('근무지 추가');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('현재 위치로 설정하기');
  } finally {
    client.clear();
  }
});
