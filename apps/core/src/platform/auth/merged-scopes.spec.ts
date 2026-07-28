import { ALL_ROLE_MAPPINGS, ALL_SCOPES } from './merged-scopes';

describe('merged authorization contract', () => {
  it('merges every BC scope exactly once', () => {
    const keys = ALL_SCOPES.map((scope) => scope.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('fulfillment.warehouse.operate');
    expect(keys).toContain('inventory.warehouse.manage');
    expect(keys).toHaveLength(9);
  });

  // ensureRoleScopeMappings 는 중복 roleName 을 만나면 던지고(authorization.service.ts:97),
  // 넘긴 목록에 없는 매핑 행을 지운다(:127). 두 BC 목록을 그냥 이어붙이면
  // logistics_manager 가 두 번 나와 부팅이 죽는다 — 이 테스트가 그 회귀를 잡는다.
  it('emits one row per role so bootstrap neither throws nor drops a mapping', () => {
    const roleNames = ALL_ROLE_MAPPINGS.map((mapping) => mapping.roleName);
    expect(new Set(roleNames).size).toBe(roleNames.length);
    expect(new Set(roleNames)).toEqual(new Set(['admin', 'logistics_worker', 'logistics_manager']));

    for (const mapping of ALL_ROLE_MAPPINGS) {
      expect(new Set(mapping.scopeKeys).size).toBe(mapping.scopeKeys.length);
    }
  });

  it('keeps each role total — the merged list is authoritative, not additive', () => {
    const scopesFor = (roleName: string) =>
      ALL_ROLE_MAPPINGS.find((mapping) => mapping.roleName === roleName)?.scopeKeys ?? [];

    expect(scopesFor('admin')).toEqual(['inventory.warehouse.manage']);
    expect(scopesFor('logistics_worker')).toEqual(['fulfillment.warehouse.operate']);
    expect([...scopesFor('logistics_manager')].sort()).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.reservation.transfer',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.shipment.reopen',
      'fulfillment.warehouse.operate',
      'inventory.warehouse.manage',
    ]);
  });

  it('never grants warehouse management to the logistics worker', () => {
    const worker = ALL_ROLE_MAPPINGS.find((mapping) => mapping.roleName === 'logistics_worker');
    expect(worker?.scopeKeys).not.toContain('inventory.warehouse.manage');
  });

  // ensureRoleScopeMappings 는 매핑된 스코프 키가 ALL_SCOPES 에 없으면 부팅을 죽인다
  // (authorization.service.ts:112-114). scopeKeys 가 string[] 이라 오타는 타입체크를
  // 통과하므로, 이 불변식이 그 크래시를 유닛 테스트 실패로 바꾼다.
  it('maps only scopes that are actually registered', () => {
    const declared = new Set(ALL_SCOPES.map((scope) => scope.key));
    for (const mapping of ALL_ROLE_MAPPINGS) {
      for (const scopeKey of mapping.scopeKeys) {
        expect(declared).toContain(scopeKey);
      }
    }
  });
});
