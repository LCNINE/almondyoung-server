import { IamService } from './iam.service';
import { LocalRolePermissionSource } from './local-role-permission.source';

describe('LocalRolePermissionSource', () => {
  const iam: Pick<IamService, 'roleSnapshot'> = {
    roleSnapshot: jest.fn(async () => ({
      version: 'v1',
      roles: Object.fromEntries([
        ['admin', ['a.b.read']],
        ['constructor', []],
      ]),
    })),
  };
  const source = new LocalRolePermissionSource(iam);

  it('reads the database snapshot as a map', async () => {
    const result = await source.fetch(null);
    expect(result.status === 'loaded' && [...result.snapshot.roles]).toEqual([
      ['admin', ['a.b.read']],
      ['constructor', []],
    ]);
  });

  it('says not-modified for the same version', async () => {
    await expect(source.fetch('v1')).resolves.toEqual({ status: 'not_modified' });
  });

  it('is always configured', () => {
    expect(source.isConfigured()).toBe(true);
  });
});
