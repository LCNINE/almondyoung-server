import { metricJobs } from './metric-jobs';

describe('metricJobs — 라이브 메트릭을 읽을 앱(스크레이프 정본 표 + main.ts 의 테넌트 모드)', () => {
  const jobs = metricJobs();
  const of = (app: string) => jobs.find((j) => j.app === app);

  it('served-tenant 소비 앱은 건너뜀을 센다', () => {
    expect(of('channel-adapter')).toEqual({ job: 'channel-adapter', app: 'channel-adapter', consumer: true });
    expect(of('wallet')?.consumer).toBe(true);
  });

  it('job 라벨과 앱 이름이 다른 앱은 앱 이름으로 적는다', () => {
    expect(of('ugc-service')).toEqual({ job: 'ugc', app: 'ugc-service', consumer: true });
  });

  it('per-message 앱(core·user-service)은 DLQ 만 본다 — 남의 테넌트를 건너뛰지 않는다', () => {
    expect(of('core')?.consumer).toBe(false);
    expect(of('user-service')?.consumer).toBe(false);
  });

  it('@app/events 를 안 쓰는 Medusa 는 읽지 않는다', () => {
    expect(jobs.map((j) => j.job)).not.toContain('medusa');
  });
});
