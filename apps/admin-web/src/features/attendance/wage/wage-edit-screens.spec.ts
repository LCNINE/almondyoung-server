import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WageWorkerDetail } from '@packages/domain-types/attendance-wage';
import { seedPermissions } from '../testing/seed-permissions';
import { wageKeys } from '../hooks/use-attendance-wage';
import { WageWorkerDetailView } from './wage-worker-detail';

const worker: WageWorkerDetail = {
  userId: 'worker',
  name: '근무자하나',
  isStaff: true,
  onRoster: true,
  groupId: 'group',
  hireDate: null,
  leaveDate: null,
  label: null,
  note: null,
  version: 1,
  currentRate: 11000,
  currentSchedule: null,
  rates: [{ id: 'rate', effectiveFrom: '2026-10-01', hourlyWage: 11000 }],
  schedules: [
    {
      id: 'schedule',
      effectiveFrom: '2026-10-01',
      effectiveTo: null,
      days: [{ weekday: 1, start: '09:00', end: '13:00', breakMinutes: 0 }],
    },
  ],
};

function render(permissions: readonly string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  seedPermissions(client, permissions);
  client.setQueryData(wageKeys.worker(worker.userId), worker);
  client.setQueryData(wageKeys.groups(), []);

  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WageWorkerDetailView, { userId: worker.userId })
      )
    );
  } finally {
    client.clear();
  }
}

describe('worker wage detail', () => {
  it('lets someone who can change wages correct or remove what was entered', () => {
    const html = render(['attendance.wage.read', 'attendance.wage.write']);

    expect(html.match(/고치기/g)?.length).toBe(2);
    expect(html.match(/삭제/g)?.length).toBe(2);
    expect(html).toContain('명단에서 빼기');
  });

  it('shows the history without edit controls to a reader', () => {
    const html = render(['attendance.wage.read']);

    expect(html).toContain('11,000원');
    expect(html).not.toContain('고치기');
    expect(html).not.toContain('명단에서 빼기');
  });
});
