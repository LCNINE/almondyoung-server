import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import { IamRepository } from '../iam.repository';
import {
  IamEscalationError,
  RoleHasMembersError,
  RoleNameTakenError,
  RoleVersionStaleError,
  SystemRoleImmutableError,
} from '../iam.errors';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RoleAdminManager } from './role-admin.manager';
import { RoleRepository } from './role.repository';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';

const role = (over: Partial<{ roleId: string; name: string; version: number; displayName: string | null }> = {}) => ({
  roleId: 'r-intern',
  name: 'intern',
  displayName: '인턴',
  description: null,
  version: 3,
  landingPath: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});
const flags = [
  { key: 'order.order.read', dangerous: false, systemOnly: false, deprecatedAt: null },
  { key: 'order.order.write', dangerous: false, systemOnly: false, deprecatedAt: null },
  { key: 'order.order.cancel', dangerous: true, systemOnly: false, deprecatedAt: null },
  { key: 'old.thing.read', dangerous: false, systemOnly: false, deprecatedAt: new Date(0) },
];

describe('RoleAdminManager', () => {
  const roles = {
    lockRole: jest.fn(),
    findRoleByName: jest.fn(),
    findRole: jest.fn(),
    grantsOf: jest.fn(),
    insertRole: jest.fn(),
    updateRole: jest.fn(),
    bumpVersion: jest.fn(),
    replaceGrants: jest.fn(),
    deleteRole: jest.fn(),
    countAssignments: jest.fn(),
    activeRoleNamesOf: jest.fn(),
  };
  const iam = { findPermissionFlags: jest.fn() };
  const audit = { record: jest.fn() };
  const myPermissions = { forRoles: jest.fn() };
  const tx = { marker: 'tx' };
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  const actor = { userId: 'u-master', loginId: 'boss', roles: ['master'], userAgent: null, requestId: null, ip: null };
  let manager: RoleAdminManager;

  beforeEach(async () => {
    jest.resetAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    iam.findPermissionFlags.mockResolvedValue(flags);
    roles.activeRoleNamesOf.mockResolvedValue(['master']);
    myPermissions.forRoles.mockImplementation(async (names: string[]) => ({
      permissions: names.includes('master') ? ['order.order.read', 'order.order.write', 'order.order.cancel'] : [],
    }));
    const module = await Test.createTestingModule({
      providers: [
        RoleAdminManager,
        { provide: RoleRepository, useValue: roles },
        { provide: IamRepository, useValue: iam },
        { provide: IamAuditCreator, useValue: audit },
        { provide: MyPermissionsReader, useValue: myPermissions },
        { provide: DbService, useValue: { run } },
        // 요청자가 일하는 테넌트(역할 정의는 전역이어도 이력은 그 테넌트에 남는다). 테넌트를 지정한 요청은 운영자 판정을
        // 거친다 — 그 판정 자체는 PlatformOperatorManager 스펙이 본다.
        {
          provide: PlatformOperatorManager,
          useValue: { workingTenant: async (_actor: unknown, requested?: string) => requested ?? '1' },
        },
      ],
    }).compile();
    manager = module.get(RoleAdminManager);
  });

  describe('replacePermissions', () => {
    beforeEach(() => {
      roles.lockRole.mockResolvedValue(role());
      roles.grantsOf.mockResolvedValue(['order.order.read']);
    });

    it('applies only the difference, bumps the version and writes one history row', async () => {
      await manager.replacePermissions(actor, 'r-intern', {
        permissions: ['order.order.read', 'order.order.write'],
        version: 3,
      });
      expect(roles.replaceGrants).toHaveBeenCalledWith('r-intern', ['order.order.write'], [], 'u-master', tx);
      expect(roles.bumpVersion).toHaveBeenCalledWith('r-intern', tx);
      expect(audit.record).toHaveBeenCalledWith(tx, actor, {
        tenantId: '1',
        action: 'role.permissions.replace',
        targetType: 'role',
        targetId: 'r-intern',
        targetLabel: '인턴',
        before: { version: 3, permissions: ['order.order.read'] },
        after: {
          version: 4,
          permissions: ['order.order.read', 'order.order.write'],
          added: ['order.order.write'],
          removed: [],
        },
      });
    });

    it('judges the actor by the roles they hold now, not the ones still in the token', async () => {
      roles.activeRoleNamesOf.mockResolvedValue([]);
      await expect(
        manager.replacePermissions(actor, 'r-intern', {
          permissions: ['order.order.read', 'order.order.write'],
          version: 3,
        }),
      ).rejects.toBeInstanceOf(IamEscalationError);
      expect(roles.replaceGrants).not.toHaveBeenCalled();
    });

    it('rejects a stale version', async () => {
      await expect(
        manager.replacePermissions(actor, 'r-intern', { permissions: ['order.order.read'], version: 2 }),
      ).rejects.toBeInstanceOf(RoleVersionStaleError);
      expect(roles.replaceGrants).not.toHaveBeenCalled();
    });

    it('does nothing when the set did not change', async () => {
      await manager.replacePermissions(actor, 'r-intern', { permissions: ['order.order.read'], version: 3 });
      expect(roles.bumpVersion).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses to grant a permission the actor does not hold', async () => {
      myPermissions.forRoles.mockResolvedValue({ permissions: ['order.order.read'] });
      await expect(
        manager.replacePermissions(actor, 'r-intern', {
          permissions: ['order.order.read', 'order.order.write'],
          version: 3,
        }),
      ).rejects.toBeInstanceOf(IamEscalationError);
    });

    it('lets the actor drop a permission they never held, like Kubernetes', async () => {
      myPermissions.forRoles.mockResolvedValue({ permissions: ['order.order.read'] });
      roles.grantsOf.mockResolvedValue(['order.order.read', 'order.order.cancel']);
      await manager.replacePermissions(actor, 'r-intern', { permissions: ['order.order.read'], version: 3 });
      expect(roles.replaceGrants).toHaveBeenCalledWith('r-intern', [], ['order.order.cancel'], 'u-master', tx);
    });

    it('still edits a role that keeps a retired permission', async () => {
      roles.grantsOf.mockResolvedValue(['old.thing.read', 'order.order.read']);
      await manager.replacePermissions(actor, 'r-intern', {
        permissions: ['old.thing.read', 'order.order.read', 'order.order.write'],
        version: 3,
      });
      expect(roles.replaceGrants).toHaveBeenCalledWith('r-intern', ['order.order.write'], [], 'u-master', tx);
    });

    it('rejects a set that opens a missing requirement', async () => {
      await expect(
        manager.replacePermissions(actor, 'r-intern', { permissions: ['order.order.write'], version: 3 }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('never edits the system role', async () => {
      roles.lockRole.mockResolvedValue(role({ roleId: 'r-master', name: 'master' }));
      await expect(
        manager.replacePermissions(actor, 'r-master', { permissions: [], version: 3 }),
      ).rejects.toBeInstanceOf(SystemRoleImmutableError);
    });
  });

  describe('create', () => {
    it('records a role made for a named tenant under that tenant (the create script)', async () => {
      roles.findRoleByName.mockResolvedValue(null);
      roles.insertRole.mockResolvedValue(role({ roleId: 'r-new', name: 't2_staff', displayName: '창고', version: 1 }));
      await manager.create(actor, {
        name: 't2_staff',
        displayName: '창고',
        landingPath: '/warehouses',
        permissions: ['order.order.read'],
        tenantId: 't2',
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        actor,
        expect.objectContaining({
          tenantId: 't2',
          action: 'role.create',
          after: expect.objectContaining({ landingPath: '/warehouses' }),
        }),
      );
    });

    it('reports a name taken by a request that committed first as a conflict, not a crash', async () => {
      roles.findRoleByName.mockResolvedValue(null);
      roles.insertRole.mockResolvedValue(null);
      await expect(
        manager.create(actor, { name: 'cs_team', displayName: 'CS 팀', permissions: ['order.order.read'] }),
      ).rejects.toBeInstanceOf(RoleNameTakenError);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('copies the source role permissions as they are now and returns the new id', async () => {
      roles.findRoleByName.mockResolvedValue(null);
      roles.findRole.mockResolvedValue(role());
      roles.grantsOf.mockResolvedValue(['old.thing.read', 'order.order.read']);
      roles.insertRole.mockResolvedValue(role({ roleId: 'r-new', name: 'cs_team', displayName: 'CS 팀', version: 1 }));
      const id = await manager.create(actor, { name: 'cs_team', displayName: 'CS 팀', copyFromRoleId: 'r-intern' });
      expect(id).toBe('r-new');
      expect(roles.replaceGrants).toHaveBeenCalledWith('r-new', ['order.order.read'], [], 'u-master', tx);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        actor,
        expect.objectContaining({ action: 'role.create', targetId: 'r-new' }),
      );
    });

    it('copies every live permission when the source is the system role', async () => {
      roles.findRoleByName.mockResolvedValue(null);
      roles.findRole.mockResolvedValue(role({ roleId: 'r-master', name: 'master' }));
      roles.insertRole.mockResolvedValue(role({ roleId: 'r-new', name: 'all', version: 1 }));
      await manager.create(actor, { name: 'all_copy', displayName: '전체', copyFromRoleId: 'r-master' });
      expect(roles.replaceGrants).toHaveBeenCalledWith(
        'r-new',
        ['order.order.cancel', 'order.order.read', 'order.order.write'],
        [],
        'u-master',
        tx,
      );
    });

    it('refuses an id that already exists', async () => {
      roles.findRoleByName.mockResolvedValue(role());
      await expect(manager.create(actor, { name: 'intern', displayName: 'x' })).rejects.toBeInstanceOf(
        RoleNameTakenError,
      );
    });
  });

  describe('delete', () => {
    beforeEach(() => roles.lockRole.mockResolvedValue(role()));

    it('refuses while someone holds the role', async () => {
      roles.countAssignments.mockResolvedValue(2);
      await expect(manager.delete(actor, 'r-intern', 3)).rejects.toBeInstanceOf(RoleHasMembersError);
      expect(roles.deleteRole).not.toHaveBeenCalled();
    });

    it('deletes an empty role and keeps its permissions in the history row', async () => {
      roles.countAssignments.mockResolvedValue(0);
      roles.grantsOf.mockResolvedValue(['order.order.read']);
      await manager.delete(actor, 'r-intern', 3);
      expect(roles.deleteRole).toHaveBeenCalledWith('r-intern', tx);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        actor,
        expect.objectContaining({
          action: 'role.delete',
          before: expect.objectContaining({ permissions: ['order.order.read'] }),
          after: null,
        }),
      );
    });
  });

  describe('update', () => {
    it('never edits the system role', async () => {
      roles.lockRole.mockResolvedValue(role({ name: 'master' }));
      await expect(manager.update(actor, 'r-master', { displayName: 'x', version: 3 })).rejects.toBeInstanceOf(
        SystemRoleImmutableError,
      );
    });

    it('treats an empty description as no description, so an unchanged save writes nothing', async () => {
      roles.lockRole.mockResolvedValue(role());
      await manager.update(actor, 'r-intern', { displayName: '인턴', description: '  ', version: 3 });
      expect(roles.updateRole).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('records only the fields that changed', async () => {
      roles.lockRole.mockResolvedValue(role());
      await manager.update(actor, 'r-intern', { displayName: '인턴(여름)', description: undefined, version: 3 });
      expect(roles.updateRole).toHaveBeenCalledWith('r-intern', { displayName: '인턴(여름)' }, tx);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        actor,
        expect.objectContaining({
          action: 'role.update',
          before: { version: 3, displayName: '인턴' },
          after: { version: 4, displayName: '인턴(여름)' },
        }),
      );
    });
  });
});
