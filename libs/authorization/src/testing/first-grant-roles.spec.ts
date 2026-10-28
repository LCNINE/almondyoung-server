import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { FIRST_GRANT_ROLE_PERMISSIONS } from './first-grant-roles';

describe('FIRST_GRANT_ROLE_PERMISSIONS', () => {
  it('admin 은 첫 등록 때 고객 개인정보 조회를 받는다', () => {
    expect(FIRST_GRANT_ROLE_PERMISSIONS.admin).toContain('customer.pii.read');
  });

  it('intern 은 쓰기 권한을 하나도 받지 않는다', () => {
    expect(FIRST_GRANT_ROLE_PERMISSIONS.intern.filter((key) => key.endsWith('.write'))).toEqual([]);
  });

  it('master 는 카탈로그 전체를 받는다', () => {
    expect(FIRST_GRANT_ROLE_PERMISSIONS.master.length).toBe(PERMISSION_CATALOG.length);
    expect(new Set(FIRST_GRANT_ROLE_PERMISSIONS.master)).toEqual(new Set(PERMISSION_CATALOG.map((p) => p.key)));
  });

  it('logistics_worker 는 카탈로그가 그 역할에 준 키와 같다', () => {
    const expected = PERMISSION_CATALOG.filter((p) =>
      p.grantOnFirstRegistration.some((role) => role === 'logistics_worker'),
    ).map((p) => p.key);
    expect([...FIRST_GRANT_ROLE_PERMISSIONS.logistics_worker].sort()).toEqual([...expected].sort());
  });
});
