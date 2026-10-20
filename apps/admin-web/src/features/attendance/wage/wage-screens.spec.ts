import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_WAGE_RULES,
  payPeriodFor,
  type PayGroup,
  type SettlementResult,
} from '@packages/domain-types/attendance-wage';
import { seedPermissions } from '../testing/seed-permissions';
import { wageKeys } from '../hooks/use-attendance-wage';
import { currentMonth } from './lib/wage-format';
import { MyWage } from './my-wage';
import { WageDecisions } from './wage-decisions';
import { WageSettlement } from './wage-settlement';

const group: PayGroup = {
  id: 'group',
  name: '시급제',
  payBasis: 'hourly',
  payday: 23,
  periodCloseDay: 0,
  payMonthOffset: 1,
  active: true,
  version: 1,
};
const month = currentMonth(new Date());
const period = payPeriodFor(group, month);

const result = (
  overrides: Partial<SettlementResult> = {}
): SettlementResult => ({
  groupId: group.id,
  ...period,
  rules: DEFAULT_WAGE_RULES,
  people: [
    {
      userId: 'worker',
      name: '근무자하나',
      days: [
        {
          workDate: period.periodStart,
          workedMinutes: 600,
          scheduledMinutes: 480,
          overtimeRecordedMinutes: 120,
          overtimeRecognizedMinutes: null,
          nightMinutes: 0,
          hourlyWage: 9000,
          absence: 'none',
        },
      ],
      weeklyHolidayMinutes: 0,
      amounts: {
        regular: 72000,
        overtime: 0,
        night: 0,
        weeklyHoliday: 0,
        paidLeave: 0,
        total: 72000,
      },
      complete: false,
      warnings: ['below_minimum_wage'],
    },
  ],
  issues: [
    {
      userId: 'worker',
      workDate: period.periodStart,
      kind: 'overtime_undecided',
    },
  ],
  totals: { people: 1, total: 72000, complete: false },
  ...overrides,
});

function render(
  element: Parameters<typeof createElement>[0],
  seed: (client: QueryClient) => void
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  seed(client);

  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(element))
    );
  } finally {
    client.clear();
  }
}

describe('wage settlement screen', () => {
  it('lists what could not be computed and keeps the amount marked as not final', () => {
    const html = render(WageSettlement, (client) => {
      seedPermissions(client, [
        'attendance.wage.read',
        'attendance.wage.write',
      ]);
      client.setQueryData(wageKeys.groups(), [group]);
      client.setQueryData(wageKeys.preview(group.id, month), result());
      client.setQueryData(wageKeys.settlements(group.id), []);
    });

    expect(html).toContain('계산하지 못한 항목 1건');
    expect(html).toContain('연장 미판정');
    expect(html).toContain('(확정 전)');
    expect(html).toContain('최저임금 미만 시급');
    expect(html).toContain('정산 확정');
    expect(html).not.toContain('엑셀 내려받기');
  });

  it('does not offer to confirm before it knows whether the period is already confirmed', () => {
    const html = render(WageSettlement, (client) => {
      seedPermissions(client, [
        'attendance.wage.read',
        'attendance.wage.write',
        'attendance.wage.export',
      ]);
      client.setQueryData(wageKeys.groups(), [group]);
      client.setQueryData(
        wageKeys.preview(group.id, month),
        result({ issues: [] })
      );
    });

    expect(html).toContain('확정 여부를 확인하고 있어요');
    expect(html).not.toContain('정산 확정');
    expect(html).not.toContain('엑셀 내려받기');
  });

  it('shows hours only for a salaried group', () => {
    const html = render(WageSettlement, (client) => {
      seedPermissions(client, ['attendance.wage.read']);
      client.setQueryData(wageKeys.groups(), [
        { ...group, payBasis: 'salaried' },
      ]);
      client.setQueryData(
        wageKeys.preview(group.id, month),
        result({
          issues: [],
          people: result().people.map((person) => ({
            ...person,
            amounts: null,
            warnings: [],
          })),
          totals: { people: 1, total: 0, complete: true },
        })
      );
      client.setQueryData(wageKeys.settlements(group.id), []);
    });

    expect(html).toContain('근무시간 통계만');
    expect(html).not.toContain('0원');
  });

  it('hides the confirm button from someone who can only read', () => {
    const html = render(WageSettlement, (client) => {
      seedPermissions(client, [
        'attendance.wage.read',
        'attendance.wage.export',
      ]);
      client.setQueryData(wageKeys.groups(), [group]);
      client.setQueryData(
        wageKeys.preview(group.id, month),
        result({ issues: [] })
      );
      client.setQueryData(wageKeys.settlements(group.id), []);
    });

    expect(html).not.toContain('정산 확정');
    expect(html).toContain('엑셀 내려받기');
  });

  it('shows the frozen snapshot of a confirmed period', () => {
    const frozen = result({
      issues: [],
      totals: { people: 1, total: 50000, complete: true },
    });

    const html = render(WageSettlement, (client) => {
      seedPermissions(client, [
        'attendance.wage.read',
        'attendance.wage.write',
      ]);
      client.setQueryData(wageKeys.groups(), [group]);
      client.setQueryData(wageKeys.preview(group.id, month), result());
      client.setQueryData(wageKeys.settlements(group.id), [
        {
          id: 'settlement',
          groupId: group.id,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          payday: period.payday,
          status: 'confirmed',
          total: 50000,
          confirmedAt: '2026-11-01T00:00:00.000Z',
          reopenedAt: null,
          reopenReason: null,
        },
      ]);
      client.setQueryData(['attendance', 'wage', 'settlement', 'settlement'], {
        id: 'settlement',
        snapshot: frozen,
      });
    });

    expect(html).toContain('확정본');
    expect(html).toContain('50,000원');
    expect(html).toContain('다시 열기');
    expect(html).not.toContain('계산하지 못한 항목');
  });
});

describe('wage decisions screen', () => {
  it('counts the days still waiting for a decision', () => {
    const html = render(WageDecisions, (client) => {
      // 판정만 하는 사람은 급여 조회 권한이 없다 — 판정용 그룹 목록을 쓴다.
      seedPermissions(client, ['attendance.request.review']);
      client.setQueryData(wageKeys.decisionGroups(), [group]);
      client.setQueryData(wageKeys.decisions(group.id, month), {
        paydayMonth: month,
        ...period,
        items: [
          {
            userId: 'worker',
            name: '근무자하나',
            workDate: period.periodStart,
            kind: 'overtime',
            recordedMinutes: 120,
            overtime: null,
            absence: null,
            leave: null,
            suggested: null,
          },
        ],
      });
    });

    expect(html).toContain('아직 안 정한 날 <strong>1건</strong>');
    expect(html).toContain('초과 2시간');
    expect(html).toContain('연장 인정');
  });
});

describe('my wage', () => {
  it('labels an estimate as not final', () => {
    const html = render(MyWage, (client) => {
      client.setQueryData(wageKeys.mine(month), {
        paydayMonth: month,
        ...period,
        status: 'estimate',
        person: result().people[0],
        issues: [
          {
            userId: 'worker',
            workDate: period.periodStart,
            kind: 'overtime_undecided',
          },
        ],
      });
    });

    expect(html).toContain('72,000원');
    expect(html).toContain('아직 확정 전이에요');
    expect(html).toContain('2시간 확인 중');
    expect(html).toContain('아직 계산하지 못한 날이 있어');
  });
});
