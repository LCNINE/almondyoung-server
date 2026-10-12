import {
  INITIAL_GRANT_ROLES,
  PERMISSION_CATALOG,
  PERMISSION_DOMAINS,
  findPermission,
  isPermission,
} from './permission-catalog';

const KEY_FORMAT = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const actionOf = (key: string) => key.split('.')[2];
const domainOf = (key: string) => key.split('.')[0];

describe('permission catalog', () => {
  it('uses the domain.resource.action format for every key', () => {
    const bad = PERMISSION_CATALOG.map((p) => p.key).filter((key) => !KEY_FORMAT.test(key));
    expect(bad).toEqual([]);
  });

  it('declares each key once', () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicated).toEqual([]);
  });

  it('only uses declared domains', () => {
    const unknown = PERMISSION_CATALOG.filter((p) => !(domainOf(p.key) in PERMISSION_DOMAINS)).map((p) => p.key);
    expect(unknown).toEqual([]);
  });

  it('never grants system-only permissions to a role', () => {
    const granted = PERMISSION_CATALOG.filter((p) => p.systemOnly && p.grantOnFirstRegistration.length > 0);
    expect(granted.map((p) => p.key)).toEqual([]);
  });

  it('keeps the intern role read-only and away from dangerous or iam permissions', () => {
    const violations = PERMISSION_CATALOG.filter(
      (p) =>
        p.grantOnFirstRegistration.includes('intern') &&
        (actionOf(p.key) !== 'read' || p.dangerous || domainOf(p.key) === 'iam'),
    );
    expect(violations.map((p) => p.key)).toEqual([]);
  });

  it('only grants to known staff roles and never lists master', () => {
    const allowed = new Set<string>(INITIAL_GRANT_ROLES);
    const unknown = PERMISSION_CATALOG.flatMap((p) => p.grantOnFirstRegistration.filter((role) => !allowed.has(role)));
    expect(unknown).toEqual([]);
  });

  it('describes every permission for the role editor', () => {
    const blank = PERMISSION_CATALOG.filter((p) => p.label.trim() === '' || p.description.trim() === '');
    expect(blank.map((p) => p.key)).toEqual([]);
  });

  it('looks permissions up by key', () => {
    expect(findPermission('order.order.read')?.label).toBe('주문 조회');
    expect(isPermission('order.order.read')).toBe(true);
    expect(isPermission('order:order:read')).toBe(false);
  });

  // 오늘 core 의 출고 «작업» 조회(상자·배치·송장)는 fulfillment.warehouse.operate 를 요구하고 admin 매핑엔 출고 스코프가 없다.
  // 반면 출고 «현황» 조회(출고 요청·직배송·주문 진행)는 스코프 없이 직원이면 통과한다. 초기 부여는 이 둘을 그대로 옮긴다.
  it('mirrors what admin can read in fulfillment today', () => {
    expect(findPermission('fulfillment.order.read')?.grantOnFirstRegistration).toEqual(
      expect.arrayContaining(['admin', 'intern']),
    );
    expect(findPermission('fulfillment.shipment.read')?.grantOnFirstRegistration).not.toContain('admin');
    expect(findPermission('fulfillment.shipment.read')?.grantOnFirstRegistration).not.toContain('intern');
  });
});
