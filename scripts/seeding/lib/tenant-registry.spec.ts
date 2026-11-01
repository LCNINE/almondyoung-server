import { sstShellStage } from './tenant-registry';

/** sst shell 은 stage 를 `SST_STAGE` 가 아니라 앱 리소스(`SST_RESOURCE_App`)로만 준다 — 2026-11-01 라이브 실측. */
describe('sstShellStage', () => {
  it('sst shell 이 주는 앱 리소스에서 stage 를 읽는다', () => {
    expect(sstShellStage({ SST_RESOURCE_App: '{"name": "lcnine-services", "stage": "live" }' })).toBe('live');
  });

  it('앱 리소스가 없으면 SST_STAGE 를 쓴다', () => {
    expect(sstShellStage({ SST_STAGE: 'dev' })).toBe('dev');
  });

  it('둘 다 없거나 읽을 수 없으면 undefined', () => {
    expect(sstShellStage({})).toBeUndefined();
    expect(sstShellStage({ SST_RESOURCE_App: 'not json' })).toBeUndefined();
    expect(sstShellStage({ SST_RESOURCE_App: '{"name": "x"}' })).toBeUndefined();
  });
});
