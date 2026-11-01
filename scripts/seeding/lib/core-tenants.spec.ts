import { parseTenantList } from '../../../libs/tenancy/src/tenant-list';
import { getServiceRegistry } from './service-registry';
import { expandCoreEntries, resolveCoreTargets, serviceLabel } from './core-tenants';

const list = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'b-two-pub', privateBucket: 'b-two-priv' },
  ]),
);

describe('resolveCoreTargets — core DB 는 테넌트 목록이 정한다', () => {
  it('목록의 테넌트마다 core DB 하나. 테넌트 1 전용 데이터는 기존 core DB 에만 간다', () => {
    expect(resolveCoreTargets(list, { legacyDatabase: 'core' })).toEqual([
      { tenantId: '1', slug: 'one', database: 'core', tenantOneData: true },
      { tenantId: '2', slug: 'two', database: 'core_two', tenantOneData: false },
    ]);
  });

  it('--tenant 가 목록 밖 slug 면 core_<slug> 하나만 지목한다', () => {
    expect(resolveCoreTargets(list, { legacyDatabase: 'core', tenantSlug: 'three' })).toEqual([
      { tenantId: null, slug: 'three', database: 'core_three', tenantOneData: false },
    ]);
  });

  it('--tenant 가 목록의 slug 면 그 테넌트의 coreDb 하나만 지목한다', () => {
    expect(resolveCoreTargets(list, { legacyDatabase: 'core', tenantSlug: 'one' })).toEqual([
      { tenantId: '1', slug: 'one', database: 'core', tenantOneData: true },
    ]);
  });

  it('slug 형식이 틀리면 거절한다 — DB 이름으로 흘러간다', () => {
    expect(() => resolveCoreTargets(list, { legacyDatabase: 'core', tenantSlug: 'Bad-Slug' })).toThrow(/slug/);
  });

  it('목록 밖 slug 의 core_<slug> 가 다른 테넌트의 coreDb 면 거절한다 — 남의 DB 를 준비 중 테넌트로 잡지 않는다', () => {
    const odd = parseTenantList(
      JSON.stringify([{ id: '7', slug: 'seven', coreDb: 'core_x', publicBucket: 'b7-pub', privateBucket: 'b7-priv' }]),
    );
    expect(() => resolveCoreTargets(odd, { legacyDatabase: 'core', tenantSlug: 'x' })).toThrow(/테넌트 7/);
  });
});

describe('expandCoreEntries — 정적 레지스트리의 core 한 줄을 테넌트마다 펼친다', () => {
  const registry = getServiceRegistry('lcnine-services', 'live');
  const targets = resolveCoreTargets(list, { legacyDatabase: 'core' });

  it('목록 펼치기: core 가 테넌트 수만큼, 나머지 서비스는 그대로', () => {
    const expanded = expandCoreEntries(registry, targets, { onlyCore: false });
    expect(expanded.filter((s) => s.name === 'core').map((s) => s.database)).toEqual(['core', 'core_two']);
    expect(expanded.filter((s) => s.name !== 'core')).toEqual(registry.filter((s) => s.name !== 'core'));
  });

  it('--tenant 지목: core DB 하나만 남는다(공유 서비스 DB 는 건드리지 않는다)', () => {
    const one = resolveCoreTargets(list, { legacyDatabase: 'core', tenantSlug: 'three' });
    expect(expandCoreEntries(registry, one, { onlyCore: true }).map((s) => s.database)).toEqual(['core_three']);
  });

  it('출력 이름에 어느 테넌트인지 붙는다', () => {
    const expanded = expandCoreEntries(registry, targets, { onlyCore: false });
    expect(expanded.filter((s) => s.name === 'core').map(serviceLabel)).toEqual(['core(테넌트 1)', 'core(테넌트 2)']);
    const prep = expandCoreEntries(
      registry,
      resolveCoreTargets(list, { legacyDatabase: 'core', tenantSlug: 'three' }),
      {
        onlyCore: true,
      },
    );
    expect(prep.map(serviceLabel)).toEqual(['core(준비 three)']);
    expect(registry.filter((s) => s.name === 'wallet').map(serviceLabel)).toEqual(['wallet']);
  });
});
