import { Test } from '@nestjs/testing';
import { IamRepository } from './iam.repository';
import { RolePermissionsReader } from './role-permissions.reader';

type Grant = { roleName: string; displayName: string | null; permissionKey: string | null };

describe('RolePermissionsReader', () => {
  const repository = {
    findActivePermissionKeys: jest.fn<Promise<string[]>, []>(),
    findStaffGrants: jest.fn<Promise<Grant[]>, [readonly string[]]>(),
  };
  let reader: RolePermissionsReader;

  const grants = (rows: Grant[]) => repository.findStaffGrants.mockResolvedValue(rows);

  beforeEach(async () => {
    jest.resetAllMocks();
    repository.findActivePermissionKeys.mockResolvedValue(['a.b.read', 'a.b.write']);
    grants([
      { roleName: 'admin', displayName: '관리자', permissionKey: 'a.b.read' },
      { roleName: 'admin', displayName: '관리자', permissionKey: 'a.b.write' },
      { roleName: 'intern', displayName: '인턴', permissionKey: 'a.b.read' },
      { roleName: 'master', displayName: '마스터', permissionKey: null },
      { roleName: 'empty_role', displayName: null, permissionKey: null },
    ]);
    const module = await Test.createTestingModule({
      providers: [RolePermissionsReader, { provide: IamRepository, useValue: repository }],
    }).compile();
    reader = module.get(RolePermissionsReader);
  });

  it('gives master every active permission regardless of stored grants', async () => {
    const snapshot = await reader.snapshot();
    expect(snapshot.roles.master).toEqual(['a.b.read', 'a.b.write']);
  });

  it('lists staff roles with their grants and keeps roles without grants', async () => {
    const snapshot = await reader.snapshot();
    expect(snapshot.roles).toEqual({
      admin: ['a.b.read', 'a.b.write'],
      intern: ['a.b.read'],
      master: ['a.b.read', 'a.b.write'],
      empty_role: [],
    });
  });

  it('excludes customer roles from the query', async () => {
    await reader.snapshot();
    expect(repository.findStaffGrants).toHaveBeenCalledWith(['user', 'membership']);
  });

  it('keeps the same version while the content is the same', async () => {
    const first = await reader.snapshot();
    const second = await reader.snapshot();
    expect(second.version).toBe(first.version);
  });

  // 역할 이름만 바뀌어도(예: 기존 역할 API 로 rename) 캐시한 쪽이 새 내용을 받아야 한다.
  it('changes the version when a role is renamed with the same grants', async () => {
    const before = await reader.snapshot();
    grants([
      { roleName: 'cs_operator', displayName: '관리자', permissionKey: 'a.b.read' },
      { roleName: 'cs_operator', displayName: '관리자', permissionKey: 'a.b.write' },
      { roleName: 'intern', displayName: '인턴', permissionKey: 'a.b.read' },
      { roleName: 'master', displayName: '마스터', permissionKey: null },
      { roleName: 'empty_role', displayName: null, permissionKey: null },
    ]);
    const after = await reader.snapshot();
    expect(after.version).not.toBe(before.version);
  });

  it('does not depend on the order rows come back in', async () => {
    const before = await reader.snapshot();
    grants([
      { roleName: 'empty_role', displayName: null, permissionKey: null },
      { roleName: 'intern', displayName: '인턴', permissionKey: 'a.b.read' },
      { roleName: 'admin', displayName: '관리자', permissionKey: 'a.b.write' },
      { roleName: 'master', displayName: '마스터', permissionKey: null },
      { roleName: 'admin', displayName: '관리자', permissionKey: 'a.b.read' },
    ]);
    expect((await reader.snapshot()).version).toBe(before.version);
  });

  it('handles role names that collide with object prototype keys', async () => {
    grants([
      { roleName: 'constructor', displayName: null, permissionKey: 'a.b.read' },
      { roleName: '__proto__', displayName: null, permissionKey: 'a.b.write' },
    ]);
    const snapshot = await reader.snapshot();
    expect(Object.keys(snapshot.roles).sort()).toEqual(['__proto__', 'constructor', 'master']);
    expect(snapshot.roles.constructor).toEqual(['a.b.read']);
    expect(Object.getOwnPropertyDescriptor(snapshot.roles, '__proto__')?.value).toEqual(['a.b.write']);
  });
});
