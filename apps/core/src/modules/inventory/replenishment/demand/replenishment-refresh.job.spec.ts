import { ReplenishmentRefreshJob } from './replenishment-refresh.job';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { DemandSeriesWriter } from './demand-series.writer';
import { DemandProfileRefresher } from './demand-profile.refresher';
import { LeadTimeProfileRefresher } from './lead-time-profile.refresher';

function build(overrides: { series?: Partial<DemandSeriesWriter>; profiles?: Partial<DemandProfileRefresher> } = {}) {
  const calls: string[] = [];
  const settingsReader = {
    read: jest.fn().mockResolvedValue({ demandRecomputeDays: 14, demandCoreSince: '2026-07-01' }),
  } as unknown as ReplenishmentSettingsReader;
  const seriesWriter = {
    rebuildCoreWindow: jest.fn(async (input) => {
      calls.push('window');
      return { from: input.from, to: input.to, rows: 3 };
    }),
    rebuildCoreFull: jest.fn(async (input) => {
      calls.push('full');
      return { from: '2026-07-01', to: input.to, rows: 30 };
    }),
    ...overrides.series,
  } as unknown as DemandSeriesWriter;
  const profileRefresher = {
    refreshAll: jest.fn(async () => {
      calls.push('profiles');
      return { skus: 2, byPattern: { smooth: 1, intermittent: 0, erratic: 0, lumpy: 0, insufficient: 0, none: 1 } };
    }),
    ...overrides.profiles,
  } as unknown as DemandProfileRefresher;
  const leadTimeRefresher = {
    refreshAll: jest.fn(async () => {
      calls.push('lead-times');
      return { suppliers: 1, routes: 1, windowFrom: '2025-09-08', windowTo: '2026-09-08' };
    }),
  } as unknown as LeadTimeProfileRefresher;
  const job = new ReplenishmentRefreshJob(settingsReader, seriesWriter, profileRefresher, leadTimeRefresher);
  return { job, calls, settingsReader, seriesWriter, profileRefresher, leadTimeRefresher };
}

// 2026-09-08 03:40 KST = 2026-09-07T18:40:00Z
const NOW = new Date('2026-09-07T18:40:00Z');

describe('ReplenishmentRefreshJob', () => {
  it('window: 설정의 재계산 일수 창으로 시계열 → 프로필 → 리드타임 순서', async () => {
    const { job, calls, seriesWriter, profileRefresher, leadTimeRefresher } = build();
    const summary = await job.run('window', NOW);
    expect(calls).toEqual(['window', 'profiles', 'lead-times']);
    expect(seriesWriter.rebuildCoreWindow).toHaveBeenCalledWith({ from: '2026-08-25', to: '2026-09-08', coreSince: '2026-07-01' });
    expect(profileRefresher.refreshAll).toHaveBeenCalledWith({ today: '2026-09-08' });
    expect(leadTimeRefresher.refreshAll).toHaveBeenCalledWith({ today: '2026-09-08' });
    expect(summary).toMatchObject({ series: 'window', today: '2026-09-08', demandSeries: { rows: 3 }, profiles: { skus: 2 }, leadTimes: { suppliers: 1 } });
    expect(summary.startedAt <= summary.finishedAt).toBe(true);
  });

  it('full: 전량 재구축을 부른다', async () => {
    const { job, calls, seriesWriter } = build();
    await job.run('full', NOW);
    expect(calls[0]).toBe('full');
    expect(seriesWriter.rebuildCoreFull).toHaveBeenCalledWith({ to: '2026-09-08', coreSince: '2026-07-01' });
  });

  it('앞 단계가 실패하면 뒤 단계를 돌리지 않고 예외를 올린다', async () => {
    const { job, calls } = build({ series: { rebuildCoreWindow: jest.fn().mockRejectedValue(new Error('boom')) } });
    await expect(job.run('window', NOW)).rejects.toThrow('boom');
    expect(calls).toEqual([]);
  });

  it('nightly 는 예외를 삼키고 로그로 남긴다 — 스케줄러를 죽이지 않는다', async () => {
    const { job } = build({ profiles: { refreshAll: jest.fn().mockRejectedValue(new Error('profile boom')) } });
    const error = jest.spyOn(job['logger'], 'error').mockImplementation(() => undefined);
    await expect(job.nightly()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('profile boom'), expect.anything());
  });
});
