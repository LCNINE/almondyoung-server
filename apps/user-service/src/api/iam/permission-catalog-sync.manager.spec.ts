import { DbService } from '@app/db';
import type { PermissionDefinition } from '@app/authorization';
import { Test } from '@nestjs/testing';
import { IamRepository } from './iam.repository';
import { PermissionCatalogSyncManager } from './permission-catalog-sync.manager';

const def = (key: string, grant: PermissionDefinition['grantOnFirstRegistration'] = []): PermissionDefinition => ({
  key,
  label: key,
  description: key,
  dangerous: false,
  systemOnly: false,
  ownerServices: ['core'],
  grantOnFirstRegistration: grant,
  requires: [],
  standalone: false,
});

describe('PermissionCatalogSyncManager', () => {
  const repository = {
    insertMissingPermissions: jest.fn(),
    findPermissionStates: jest.fn(),
    markDeprecated: jest.fn(),
    clearDeprecated: jest.fn(),
    findRoleIdsByNames: jest.fn(),
    insertGrants: jest.fn(),
    findPermissionDefinitions: jest.fn(),
    updatePermissionDefinition: jest.fn(),
  };
  const tx = { marker: 'tx' };
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  let manager: PermissionCatalogSyncManager;

  beforeEach(async () => {
    jest.resetAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    repository.findPermissionStates.mockResolvedValue([]);
    repository.markDeprecated.mockResolvedValue(0);
    repository.clearDeprecated.mockResolvedValue(0);
    repository.findPermissionDefinitions.mockResolvedValue([]);
    repository.findRoleIdsByNames.mockResolvedValue(
      new Map([
        ['admin', 'role-admin'],
        ['intern', 'role-intern'],
      ]),
    );
    const module = await Test.createTestingModule({
      providers: [
        PermissionCatalogSyncManager,
        { provide: IamRepository, useValue: repository },
        { provide: DbService, useValue: { run } },
      ],
    }).compile();
    manager = module.get(PermissionCatalogSyncManager);
  });

  it('grants only the keys this call actually inserted', async () => {
    repository.insertMissingPermissions.mockResolvedValue(['a.b.read']);
    const result = await manager.sync([def('a.b.read', ['admin', 'intern']), def('a.b.write', ['admin'])]);

    expect(repository.insertGrants).toHaveBeenCalledWith(
      [
        { roleId: 'role-admin', permissionKey: 'a.b.read' },
        { roleId: 'role-intern', permissionKey: 'a.b.read' },
      ],
      tx,
    );
    expect(result.grants).toBe(2);
  });

  it('does nothing when the catalog is already in the database', async () => {
    repository.insertMissingPermissions.mockResolvedValue([]);
    repository.findPermissionStates.mockResolvedValue([{ key: 'a.b.read', deprecatedAt: null }]);
    const result = await manager.sync([def('a.b.read', ['admin'])]);

    expect(repository.insertGrants).not.toHaveBeenCalled();
    expect(result).toMatchObject({ inserted: [], deprecated: 0, restored: 0, grants: 0 });
  });

  it('deprecates keys that left the catalog without deleting their grants', async () => {
    repository.insertMissingPermissions.mockResolvedValue([]);
    repository.findPermissionStates.mockResolvedValue([
      { key: 'a.b.read', deprecatedAt: null },
      { key: 'a.old.read', deprecatedAt: null },
    ]);
    repository.markDeprecated.mockResolvedValue(1);
    const result = await manager.sync([def('a.b.read')]);

    expect(repository.markDeprecated).toHaveBeenCalledWith(['a.old.read'], tx);
    expect(result.deprecated).toBe(1);
  });

  it('restores a returning key without granting it again', async () => {
    repository.insertMissingPermissions.mockResolvedValue([]);
    repository.findPermissionStates.mockResolvedValue([{ key: 'a.b.read', deprecatedAt: new Date() }]);
    repository.clearDeprecated.mockResolvedValue(1);
    const result = await manager.sync([def('a.b.read', ['admin'])]);

    expect(repository.clearDeprecated).toHaveBeenCalledWith(['a.b.read'], tx);
    expect(repository.insertGrants).not.toHaveBeenCalled();
    expect(result.restored).toBe(1);
  });

  it('reports initial-grant roles that do not exist yet instead of failing', async () => {
    repository.insertMissingPermissions.mockResolvedValue(['a.b.read']);
    repository.findRoleIdsByNames.mockResolvedValue(new Map([['admin', 'role-admin']]));
    const result = await manager.sync([def('a.b.read', ['admin', 'logistics_worker'])]);

    expect(result.missingRoles).toEqual(['logistics_worker']);
    expect(repository.insertGrants).toHaveBeenCalledWith([{ roleId: 'role-admin', permissionKey: 'a.b.read' }], tx);
  });

  it('only deprecates keys under the given prefix', async () => {
    repository.insertMissingPermissions.mockResolvedValue([]);
    repository.findPermissionStates.mockResolvedValue([
      { key: 'zz.old.read', deprecatedAt: null },
      { key: 'order.order.read', deprecatedAt: null },
    ]);
    await manager.sync([], { scopePrefix: 'zz.' });
    expect(repository.markDeprecated).toHaveBeenCalledWith(['zz.old.read'], tx);
  });

  it('brings a stored label, description and flags back to the code values', async () => {
    repository.insertMissingPermissions.mockResolvedValue([]);
    repository.findPermissionDefinitions.mockResolvedValue([
      { key: 'a.b.read', domain: 'a', label: '옛 이름', description: '옛 설명', dangerous: true, systemOnly: false },
    ]);
    const result = await manager.sync([def('a.b.read')]);
    expect(repository.updatePermissionDefinition).toHaveBeenCalledWith(
      { key: 'a.b.read', domain: 'a', label: 'a.b.read', description: 'a.b.read', dangerous: false, systemOnly: false },
      tx,
    );
    expect(result.relabeled).toBe(1);
  });

  it('leaves a definition that already matches and one outside the catalog alone', async () => {
    repository.insertMissingPermissions.mockResolvedValue([]);
    repository.findPermissionDefinitions.mockResolvedValue([
      { key: 'a.b.read', domain: 'a', label: 'a.b.read', description: 'a.b.read', dangerous: false, systemOnly: false },
      { key: 'gone.x.read', domain: 'gone', label: '옛', description: '옛', dangerous: false, systemOnly: false },
    ]);
    const result = await manager.sync([def('a.b.read')]);
    expect(repository.updatePermissionDefinition).not.toHaveBeenCalled();
    expect(result.relabeled).toBe(0);
  });
});
