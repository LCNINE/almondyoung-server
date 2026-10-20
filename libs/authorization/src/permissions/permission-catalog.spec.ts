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

  // 관리자도 물류 관리자와 같은 출고 권한을 갖는다(팀별 역할로 나눌 때 역할 편집에서 회수한다).
  it('gives admin the same fulfillment permissions as the logistics manager', () => {
    const fulfillment = PERMISSION_CATALOG.filter((p) => p.key.startsWith('fulfillment.') && !p.systemOnly);
    const managerOnly = fulfillment.filter(
      (p) => p.grantOnFirstRegistration.some((r) => r === 'logistics_manager') && !p.grantOnFirstRegistration.some((r) => r === 'admin'),
    );
    expect(managerOnly.map((p) => p.key)).toEqual([]);
    expect(findPermission('fulfillment.shipment.read')?.grantOnFirstRegistration).not.toContain('intern');
  });

  it('registers the keys that the route table needs with today-equivalent grants', () => {
    const expected: Record<string, readonly string[]> = {
      'inventory.master.read': ['admin', 'intern', 'logistics_manager'],
      'fulfillment.order.write': ['admin'],
      'marketing.display.read': ['admin', 'intern'],
      'marketing.almond_template.read': ['admin', 'intern'],
      'catalog.product.export': ['admin'],
      'customer.dormant.execute': [],
      'payment.payment.write': ['admin'],
      'payment.billing.execute': ['admin'],
      'messaging.provider.write': ['admin'],
      'analytics.keyword.write': ['admin'],
      'system.operations.read': ['admin'],
    };
    const actual = Object.fromEntries(
      Object.keys(expected).map((key) => [key, findPermission(key)?.grantOnFirstRegistration ?? null]),
    );
    expect(actual).toEqual(expected);
    expect(PERMISSION_CATALOG).toHaveLength(112);
  });

  it('registers the wage permissions for master only', () => {
    const expected: Record<string, readonly string[]> = {
      'attendance.wage.read': ['attendance.staff.read'],
      'attendance.wage.write': ['attendance.wage.read'],
      'attendance.wage.export': ['attendance.wage.read'],
    };

    for (const [key, requires] of Object.entries(expected)) {
      const permission = findPermission(key);

      expect(permission?.grantOnFirstRegistration).toEqual([]);
      expect(permission?.dangerous).toBe(true);
      expect(permission?.requires).toEqual(requires);
    }
  });

  it('registers attendance keys with today-equivalent grants', () => {
    // 내 근태는 오늘 근태를 쓰는 admin, 관리(남의 기록·검토·통계·근무지)는 오늘처럼 master 만
    expect(findPermission('attendance.own.write')?.grantOnFirstRegistration).toEqual(['admin']);
    for (const key of [
      'attendance.staff.read',
      'attendance.request.review',
      'attendance.statistics.read',
      'attendance.worksite.write',
    ]) {
      expect(findPermission(key)?.grantOnFirstRegistration).toEqual([]);
    }
  });

  it('declares the recipient permission for logistics and admin', () => {
    const recipient = findPermission('fulfillment.recipient.read');
    expect(recipient?.dangerous).toBe(true);
    expect(recipient?.grantOnFirstRegistration).toEqual(['admin', 'logistics_worker', 'logistics_manager']);
    expect(recipient?.requires).toEqual(['fulfillment.order.read']);
  });

  it('registers the handler checkpoint keys with today-equivalent grants', () => {
    expect(findPermission('fulfillment.work.supervise')?.grantOnFirstRegistration).toEqual(['admin', 'logistics_manager']);
    expect(findPermission('fulfillment.work.supervise')?.dangerous).toBe(false);
    expect(findPermission('system.file.manage')?.grantOnFirstRegistration).toEqual([]);
    expect(findPermission('system.file.manage')?.dangerous).toBe(true);
  });

  it('registers read access to the region and shipping settings for the screens that show them', () => {
    expect(findPermission('system.region.read')?.grantOnFirstRegistration).toEqual(['admin', 'intern']);
    expect(findPermission('system.shipping_profile.read')?.grantOnFirstRegistration).toEqual(['admin', 'intern']);
    expect(findPermission('system.region.read')?.dangerous).toBe(false);
  });
});
