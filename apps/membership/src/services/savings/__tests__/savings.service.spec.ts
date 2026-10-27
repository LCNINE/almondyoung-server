import { SavingsService } from '../savings.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function build(opts: {
  rows: any[];
  markers?: { grantDays: Record<string, number>; supersededBy: Record<string, string> };
  events: Array<{ orderId: string; orderDate: Date; discountAmount: number }>;
  endsAt?: string;
}) {
  const markers = {
    grantDays: new Map(Object.entries(opts.markers?.grantDays ?? {})),
    supersededBy: new Map(Object.entries(opts.markers?.supersededBy ?? {})),
  };
  const contractReader = {
    findContractsByUserIdWithPlan: jest.fn().mockResolvedValue(opts.rows),
    findGrantMarkersByUserId: jest.fn().mockResolvedValue(markers),
  };
  const entitlementService = {
    getUserEntitlement: jest.fn().mockResolvedValue(opts.endsAt ? { entitlement: { endsAt: opts.endsAt } } : null),
  };
  const benefitReader = { findDiscountEventsBetween: jest.fn().mockResolvedValue(opts.events) };
  return new SavingsService({} as any, benefitReader as any, contractReader as any, entitlementService as any);
}

const grantRow = {
  contract: { id: 'grant', status: 'CANCELLED', billingDate: d('2026-10-01'), cancelledAt: d('2026-10-26') },
  plan: { durationDays: 30 },
};
const paidRow = {
  contract: { id: 'paid', status: 'ACTIVE', billingDate: d('2026-11-15'), cancelledAt: null },
  plan: { durationDays: 30 },
};

describe('SavingsService 임시 이용권 이어받기 주기', () => {
  afterEach(() => jest.useRealTimers());

  const events = [
    { orderId: 'a', orderDate: d('2026-10-30'), discountAmount: 1000 },
    { orderId: 'b', orderDate: d('2026-11-20'), discountAmount: 2000 },
  ];
  const takeover = {
    rows: [paidRow, grantRow],
    markers: { grantDays: { grant: 30 }, supersededBy: { grant: 'paid' } },
    events,
    endsAt: '2026-12-15T00:00:00.000Z',
  };

  it('임시 주기는 하나로 11/15 까지, 유료 주기는 11/15 부터이며 둘 다 누적에 포함된다', async () => {
    jest.useFakeTimers().setSystemTime(d('2026-11-22'));
    const overview = await build(takeover).getOverview('u');

    const grantPeriods = overview.periods.filter((p) => p.contractId === 'grant');
    expect(grantPeriods).toHaveLength(1);
    expect(grantPeriods[0].endDate).toBe(d('2026-11-15').toISOString());
    expect(grantPeriods[0].totalSavings).toBe(1000);
    expect(overview.periods.find((p) => p.contractId === 'paid')?.totalSavings).toBe(2000);
    expect(overview.allTime).toEqual({ totalSavings: 3000, orderCount: 2 });
    expect(overview.currentPeriod?.contractId).toBe('paid');
  });

  it('11/02 에는 현재 주기가 임시 이용권 주기다', async () => {
    jest.useFakeTimers().setSystemTime(d('2026-11-02'));
    const overview = await build(takeover).getOverview('u');
    expect(overview.currentPeriod?.contractId).toBe('grant');
  });

  it('이어받기 없는 유료 계약은 기존처럼 자격 종료일 기준이다', async () => {
    jest.useFakeTimers().setSystemTime(d('2026-11-22'));
    const overview = await build({ rows: [paidRow], events, endsAt: '2026-12-15T00:00:00.000Z' }).getOverview('u');
    expect(overview.periods).toHaveLength(1);
    expect(overview.periods[0].endDate).toBe(d('2026-12-15').toISOString());
    expect(overview.allTime).toEqual({ totalSavings: 2000, orderCount: 1 });
  });

  it('유료 계약이 시작 전에 해지돼 지급이 복구되면 주기가 겹치지 않고 목록과 상세가 일치한다', async () => {
    jest.useFakeTimers().setSystemTime(d('2026-11-20'));
    const cancelledPaid = {
      contract: { id: 'paid', status: 'CANCELLED', billingDate: d('2026-11-15'), cancelledAt: new Date('2026-11-02T12:00:00.000Z') },
      plan: { durationDays: 30 },
    };
    const restored = {
      contract: { id: 'restored', status: 'ACTIVE', billingDate: d('2026-11-02'), cancelledAt: null },
      plan: { durationDays: 30 },
    };
    const orders = [{ orderId: 'x', orderDate: new Date('2026-11-02T06:00:00.000Z'), discountAmount: 1000 }];
    const svc = build({
      rows: [restored, cancelledPaid, grantRow],
      markers: { grantDays: { grant: 30, restored: 13 }, supersededBy: { grant: 'paid' } },
      events: orders,
      endsAt: '2026-11-15T00:00:00.000Z',
    });
    // 상세 조회는 기간으로 질의하므로 기간에 맞게 거른다
    const benefit = (svc as any).benefitReader;
    benefit.findDiscountEventsBetween.mockImplementation(async (_u: string, from: Date, to?: Date) =>
      orders.filter((o) => o.orderDate >= from && (!to || o.orderDate < to)),
    );

    const overview = await svc.getOverview('u');
    const g = overview.periods.find((p) => p.contractId === 'grant')!;
    expect(g.endDate).toBe(d('2026-11-02').toISOString());
    expect(g.totalSavings).toBe(0);
    expect(overview.periods.find((p) => p.contractId === 'restored')?.totalSavings).toBe(1000);
    expect(overview.allTime).toEqual({ totalSavings: 1000, orderCount: 1 });

    for (const p of overview.periods) {
      const detail = await svc.getPeriodDetail('u', p.id);
      expect(detail.totalSavings).toBe(p.totalSavings);
    }
  });

  it('플랜 30일에 45일 지급한 만료 계약은 45일짜리 한 주기다', async () => {
    jest.useFakeTimers().setSystemTime(d('2026-12-30'));
    const expiredGrant = {
      contract: { id: 'g45', status: 'EXPIRED', billingDate: d('2026-10-01'), cancelledAt: null },
      plan: { durationDays: 30 },
    };
    const overview = await build({
      rows: [expiredGrant],
      markers: { grantDays: { g45: 45 }, supersededBy: {} },
      events: [{ orderId: 'y', orderDate: d('2026-11-10'), discountAmount: 500 }],
    }).getOverview('u');
    expect(overview.periods).toHaveLength(1);
    expect(overview.periods[0].endDate).toBe(d('2026-11-15').toISOString());
    expect(overview.allTime.totalSavings).toBe(500);
  });
});
