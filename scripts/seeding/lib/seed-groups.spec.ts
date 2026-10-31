import { buildCoreSeedSteps } from './core-seed-steps';
import { selectReferenceSeedGroups, ALL_TENANTS_SEED_GROUP, TENANT1_ONLY_SEED_GROUP } from './seed-groups';

/**
 * core 참조 시드는 두 갈래다. 새 테넌트 DB 엔 «모든 테넌트» 갈래만 든다 — 거기에 창고(WMS)나
 * 자사몰 판매채널(PIM) 스텝이 섞이면 새 테넌트가 아몬드영 창고·채널을 갖고 태어난다.
 */
describe('core 참조 시드 갈래', () => {
  const steps = buildCoreSeedSteps('postgres://placeholder:placeholder@localhost:5432/placeholder');
  afterAll(() => Promise.all(steps.map((s) => s.dispose())));

  const servicesIn = (group: string) =>
    steps
      .filter((s) => s.groups.includes(group))
      .map((s) => s.serviceName)
      .sort();

  it('«모든 테넌트» 갈래는 보충 기본값·등급 규칙뿐이다 — 창고·판매채널이 없다', () => {
    expect(servicesIn(ALL_TENANTS_SEED_GROUP)).toEqual(['Replenishment']);
  });

  it('«테넌트 1 전용» 갈래는 창고·구역·창고 설정(WMS)과 자사몰 판매채널(PIM)이다', () => {
    expect(servicesIn(TENANT1_ONLY_SEED_GROUP)).toEqual(['PIM', 'WMS']);
  });

  it('한 스텝이 두 갈래에 동시에 들지 않는다', () => {
    for (const s of steps) {
      expect(s.groups.includes(ALL_TENANTS_SEED_GROUP) && s.groups.includes(TENANT1_ONLY_SEED_GROUP)).toBe(false);
    }
  });
});

describe('selectReferenceSeedGroups (db:seed:ref)', () => {
  // 지금 db:seed:ref 가 도는 DB 는 테넌트 1(기존 core) 하나뿐이라 두 갈래를 다 돌아야 오늘과 같다.
  it('두 갈래를 다 고르고 demo-·backfill 은 뺀다', () => {
    expect(
      selectReferenceSeedGroups(['backfill', 'baseline', 'baseline-tenant-1', 'demo-logistics', 'demo-salon']),
    ).toEqual(['baseline', 'baseline-tenant-1']);
  });
});
