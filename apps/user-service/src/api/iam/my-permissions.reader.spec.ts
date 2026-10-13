import { Test } from '@nestjs/testing';
import { IamRepository } from './iam.repository';
import { MyPermissionsReader } from './my-permissions.reader';
import { RolePermissionsReader } from './role-permissions.reader';

describe('MyPermissionsReader', () => {
  const snapshot = {
    version: 'v1',
    roles: { admin: ['a.b.read', 'a.b.write'], intern: ['a.b.read', 'c.d.read'] },
  };
  const roles = { snapshot: jest.fn().mockResolvedValue(snapshot) };
  const repository = { findRolesByNames: jest.fn() };
  let reader: MyPermissionsReader;

  beforeEach(async () => {
    repository.findRolesByNames.mockResolvedValue([
      { name: 'admin', displayName: '관리자' },
      { name: 'intern', displayName: null },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        MyPermissionsReader,
        { provide: RolePermissionsReader, useValue: roles },
        { provide: IamRepository, useValue: repository },
      ],
    }).compile();
    reader = module.get(MyPermissionsReader);
  });

  it('unions permissions across roles without duplicates', async () => {
    const result = await reader.forRoles(['admin', 'intern']);
    expect(result.permissions).toEqual(['a.b.read', 'a.b.write', 'c.d.read']);
    expect(result.version).toBe('v1');
  });

  it('falls back to the role name when there is no display name', async () => {
    const result = await reader.forRoles(['admin', 'intern']);
    expect(result.roles).toEqual([
      { name: 'admin', displayName: '관리자' },
      { name: 'intern', displayName: 'intern' },
    ]);
  });

  it('gives a customer no permissions', async () => {
    repository.findRolesByNames.mockResolvedValueOnce([{ name: 'user', displayName: '일반 회원' }]);
    const result = await reader.forRoles(['user']);
    expect(result.permissions).toEqual([]);
  });

  // 역할 이름이 사람 입력이라 상속 속성 이름과 겹쳐도 남의 권한이 섞이면 안 된다.
  it('ignores role names that only exist on the object prototype', async () => {
    repository.findRolesByNames.mockResolvedValueOnce([]);
    const result = await reader.forRoles(['constructor', 'toString']);
    expect(result.permissions).toEqual([]);
  });
});
