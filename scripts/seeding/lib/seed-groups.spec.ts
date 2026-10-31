import { buildCoreSeedSteps } from './core-seed-steps';
import { selectReferenceSeedGroups, ALL_TENANTS_SEED_GROUP, TENANT1_ONLY_SEED_GROUP } from './seed-groups';
import { listGroupsForRegistry } from '../phases/03-seed-orchestrator';
import { ServiceConfig } from './types';

// 오케스트레이터가 끌어오는 `sst` 는 ESM 이라 jest 가 못 읽는다. 그룹 목록은 DB 에 붙지 않는다.
jest.mock('./db-connection', () => ({ buildDatabaseUrl: () => 'postgres://placeholder@localhost/placeholder' }));

const PLACEHOLDER_URL = 'postgres://placeholder:placeholder@localhost:5432/placeholder';

/**
 * core 참조 시드는 두 갈래다. 새 테넌트 DB 엔 «모든 테넌트» 갈래만 든다 — 거기에 창고(WMS)나
 * 자사몰 판매채널(PIM) 스텝이 섞이면 새 테넌트가 아몬드영 창고·채널을 갖고 태어난다.
 */
describe('core 참조 시드 갈래', () => {
  const steps = buildCoreSeedSteps(PLACEHOLDER_URL);
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
  // 갈래를 어느 core DB 에 넣을지는 스텝을 만들 때 테넌트마다 정한다 — 여기선 demo-·backfill 만 거른다.
  it('두 갈래를 다 고르고 demo-·backfill 은 뺀다', () => {
    expect(
      selectReferenceSeedGroups(['backfill', 'baseline', 'baseline-tenant-1', 'demo-logistics', 'demo-salon']),
    ).toEqual(['baseline', 'baseline-tenant-1']);
  });
});

/** 새 테넌트 DB 에 db:seed:ref 를 돌리면 «모든 테넌트» 갈래만 든다 — 창고·자사몰 채널 0행, 보충 기본값·등급 규칙은 있다. */
describe('테넌트 1 이 아닌 core DB 의 참조 시드', () => {
  it('core 스텝은 보충 기본값·등급 규칙(Replenishment)뿐이다', async () => {
    const steps = buildCoreSeedSteps(PLACEHOLDER_URL, { tenantOneData: false });
    try {
      expect(steps.map((s) => s.serviceName)).toEqual(['Replenishment']);
    } finally {
      await Promise.all(steps.map((s) => s.dispose()));
    }
  });

  const core = (database: string, tenantOneData: boolean): ServiceConfig => ({
    name: 'core',
    database,
    drizzleConfig: 'apps/core/drizzle.config.ts',
    hasSeedStep: true,
    tenant: { tenantId: null, slug: database, database, tenantOneData },
  });

  it('--tenant 로 새 테넌트 DB 하나만 지목하면 도는 그룹은 «모든 테넌트» 하나다', async () => {
    await expect(listGroupsForRegistry([core('core_two', false)])).resolves.toEqual([ALL_TENANTS_SEED_GROUP]);
  });

  it('목록에 테넌트 1 과 새 테넌트가 함께 있으면 테넌트 1 전용 갈래도 남는다(테넌트 1 DB 에만 간다)', async () => {
    const groups = await listGroupsForRegistry([core('core', true), core('core_two', false)]);
    expect(selectReferenceSeedGroups(groups)).toEqual([ALL_TENANTS_SEED_GROUP, TENANT1_ONLY_SEED_GROUP]);
  });
});
