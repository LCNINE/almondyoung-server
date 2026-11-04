import { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import {
  IamEscalationError,
  IamGrantedElsewhereError,
  IamNotAccountTenantError,
  IamOperatorOnlyError,
  IamSelfChangeError,
  IamStaffCannotLeaveError,
  IamTenantUnresolvedError,
} from '../iam.errors';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { GrantAuthority } from './grant-authority';
import { endOfKoreanDay, RoleAssignmentManager } from './role-assignment.manager';

const at = new Date(0);
const ROLES = {
  master: { roleId: 'r-master', name: 'master', displayName: '마스터' },
  admin: { roleId: 'r-admin', name: 'admin', displayName: '관리자' },
  intern: { roleId: 'r-intern', name: 'intern', displayName: '인턴' },
  membership: { roleId: 'r-membership', name: 'membership', displayName: '멤버십' },
};
const ALL = Object.values(ROLES).map((r) => ({
  ...r,
  description: null,
  version: 1,
  landingPath: null,
  createdAt: at,
  updatedAt: at,
}));
const GRANTS: Record<string, string[]> = {
  master: ['a.b.read', 'a.b.write', 'c.d.read', 'customer.profile.write'],
  admin: ['a.b.read', 'a.b.write'],
  intern: ['a.b.read'],
};

describe('RoleAssignmentManager', () => {
  const roles = {
    findUser: jest.fn(),
    findRolesByIds: jest.fn(),
    findRoleByName: jest.fn(),
    lockRole: jest.fn(),
    assignmentsOf: jest.fn(),
    insertAssignments: jest.fn(),
    deleteAssignments: jest.fn(),
    updateExpiry: jest.fn(),
    countPermanentHolders: jest.fn(),
    activeRoleNamesOf: jest.fn(),
    hasLiveStaffRole: jest.fn(),
  };
  const tenancy = {
    accountTenantOf: jest.fn(),
    isOperator: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const myPermissions = { forRoles: jest.fn() };
  const snapshots = { snapshot: jest.fn() };
  const tx = { marker: 'tx' };
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  const master = { userId: 'u-boss', loginId: 'boss', roles: ['master'], userAgent: null, requestId: null, ip: null };
  const adminActor = { userId: 'u-adm', loginId: 'adm', roles: ['admin'], userAgent: null, requestId: null, ip: null };
  let manager: RoleAssignmentManager;

  beforeEach(async () => {
    jest.resetAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    snapshots.snapshot.mockResolvedValue({ version: 'v', roles: GRANTS });
    myPermissions.forRoles.mockImplementation(async (names: string[]) => ({
      permissions: [...new Set(names.flatMap((n) => GRANTS[n] ?? []))],
    }));
    roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: true, tenantId: '1' });
    roles.findRolesByIds.mockImplementation(async (ids: readonly string[]) =>
      ALL.filter((r) => ids.includes(r.roleId)),
    );
    // 요청자는 테넌트 1 에서 일하고, 대상 계정도 테넌트 1 의 것이 기본이다.
    tenancy.accountTenantOf.mockResolvedValue('1');
    tenancy.isOperator.mockImplementation(async (userId: string) => userId === master.userId);
    roles.activeRoleNamesOf.mockImplementation(async (userId: string) =>
      userId === master.userId ? ['master'] : userId === adminActor.userId ? ['admin'] : [],
    );
    const module = await Test.createTestingModule({
      providers: [
        RoleAssignmentManager,
        GrantAuthority,
        { provide: RoleRepository, useValue: roles },
        { provide: TenancyRepository, useValue: tenancy },
        ActorTenantReader,
        PlatformOperatorManager,
        { provide: IamAuditCreator, useValue: audit },
        { provide: MyPermissionsReader, useValue: myPermissions },
        { provide: RolePermissionsReader, useValue: snapshots },
        { provide: DbService, useValue: { run } },
      ],
    }).compile();
    manager = module.get(RoleAssignmentManager);
  });

  const held = (...rows: { role: keyof typeof ROLES; expiresAt?: Date | null; tenantId?: string }[]) =>
    roles.assignmentsOf.mockResolvedValue(
      rows.map(({ role, expiresAt, tenantId }) => ({
        ...ROLES[role],
        assignedAt: at,
        expiresAt: expiresAt ?? null,
        tenantId: tenantId ?? '1',
      })),
    );

  it('keeps the end date of an assignment it did not change', async () => {
    held({ role: 'intern', expiresAt: new Date('2099-12-31T14:59:59.999Z') }, { role: 'membership' });
    await manager.replaceAll(master, 'u-target', ['r-intern', 'r-membership', 'r-admin']);
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', [], tx);
    expect(roles.updateExpiry).not.toHaveBeenCalled();
    expect(roles.insertAssignments).toHaveBeenCalledWith('u-target', '1', [{ roleId: 'r-admin', expiresAt: null }], tx);
  });

  it('keeps the full replace contract for the customer screen', async () => {
    held({ role: 'membership' }, { role: 'intern' });
    await manager.replaceAll(master, 'u-target', ['r-intern']);
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', ['r-membership'], tx);
  });

  it('leaves customer roles alone when only staff roles are edited', async () => {
    held({ role: 'membership' }, { role: 'intern' });
    await manager.replaceStaff(master, 'u-target', [{ roleId: 'r-admin', expiresAt: null }]);
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', ['r-intern'], tx);
    expect(roles.insertAssignments).toHaveBeenCalledWith('u-target', '1', [{ roleId: 'r-admin', expiresAt: null }], tx);
  });

  it('refuses to change your own roles', async () => {
    held();
    roles.findUser.mockResolvedValue({ id: 'u-boss', loginId: 'boss', username: '보스', canSignIn: true, tenantId: '1' });
    await expect(manager.replaceStaff(master, 'u-boss', [])).rejects.toBeInstanceOf(IamSelfChangeError);
  });

  it('refuses to assign a role whose permissions the actor does not fully hold, with a 403', async () => {
    held();
    await expect(
      manager.replaceStaff(adminActor, 'u-target', [{ roleId: 'r-master', expiresAt: null }]),
    ).rejects.toBeInstanceOf(IamEscalationError);
  });

  it('refuses to take away a role the actor could not have given', async () => {
    held({ role: 'master' });
    await expect(manager.replaceStaff(adminActor, 'u-target', [])).rejects.toBeInstanceOf(IamEscalationError);
  });

  it('requires customer.profile.write to change a customer role', async () => {
    held();
    await expect(manager.replaceAll(adminActor, 'u-target', ['r-membership'])).rejects.toBeInstanceOf(
      IamEscalationError,
    );
    expect(roles.insertAssignments).not.toHaveBeenCalled();
  });

  it('lets a master change a customer role as before', async () => {
    held();
    await manager.replaceAll(master, 'u-target', ['r-membership']);
    expect(roles.insertAssignments).toHaveBeenCalledWith(
      'u-target',
      '1',
      [{ roleId: 'r-membership', expiresAt: null }],
      tx,
    );
  });

  it('asks for it when a customer role is removed', async () => {
    held({ role: 'membership' });
    await expect(manager.replaceAll(adminActor, 'u-target', [])).rejects.toBeInstanceOf(IamEscalationError);
  });

  it('does not ask for it when only staff roles change', async () => {
    held({ role: 'membership' });
    await manager.replaceAll(adminActor, 'u-target', ['r-membership', 'r-intern']);
    expect(roles.insertAssignments).toHaveBeenCalledWith(
      'u-target',
      '1',
      [{ roleId: 'r-intern', expiresAt: null }],
      tx,
    );
  });

  it('lets the last permanent master lose the role — lock-out is guarded by platform operators now', async () => {
    held({ role: 'master' });
    await expect(manager.replaceStaff(master, 'u-target', [])).resolves.toBeUndefined();
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', ['r-master'], tx);
  });

  it('judges the actor by the roles they hold now, not the ones still in the token', async () => {
    held();
    roles.activeRoleNamesOf.mockResolvedValue([]);
    await expect(
      manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]),
    ).rejects.toBeInstanceOf(IamEscalationError);
  });

  it('never widens the actor beyond the roles in the token', async () => {
    held();
    roles.activeRoleNamesOf.mockResolvedValue(['admin', 'master']);
    await expect(
      manager.replaceStaff(adminActor, 'u-target', [{ roleId: 'r-master', expiresAt: null }]),
    ).rejects.toBeInstanceOf(IamEscalationError);
  });

  it('keeps an expired staff assignment the editor did not mention', async () => {
    held({ role: 'intern', expiresAt: new Date('2000-01-01T00:00:00Z') }, { role: 'admin' });
    await manager.replaceStaff(master, 'u-target', [{ roleId: 'r-admin', expiresAt: '2099-01-01' }]);
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', [], tx);
    expect(roles.updateExpiry).toHaveBeenCalledWith('u-target', '1', 'r-admin', endOfKoreanDay('2099-01-01'), tx);
  });

  it('takes a role named twice in one request as one assignment', async () => {
    held();
    await manager.replaceStaff(master, 'u-target', [
      { roleId: 'r-intern', expiresAt: null },
      { roleId: 'r-intern', expiresAt: '2099-01-01' },
    ]);
    expect(roles.insertAssignments).toHaveBeenCalledWith(
      'u-target',
      '1',
      [{ roleId: 'r-intern', expiresAt: endOfKoreanDay('2099-01-01') }],
      tx,
    );
  });

  it('rejects an end date that is not after today', () => {
    expect(() => endOfKoreanDay('2000-01-01')).toThrow(BadRequestError);
    expect(() => endOfKoreanDay('2026-13-01')).toThrow(BadRequestError);
  });

  it('ends an assignment at the close of the chosen day in Korea', () => {
    expect(endOfKoreanDay('2026-10-31', new Date('2026-10-13T00:00:00Z'))).toEqual(
      new Date('2026-10-31T14:59:59.999Z'),
    );
  });

  it('refuses customer roles in the staff editor', async () => {
    held();
    await expect(
      manager.replaceStaff(master, 'u-target', [{ roleId: 'r-membership', expiresAt: null }]),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('writes one history row with the assignments before and after', async () => {
    held({ role: 'intern' });
    await manager.replaceStaff(master, 'u-target', [{ roleId: 'r-admin', expiresAt: null }]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, master, {
      tenantId: '1',
      action: 'user.roles.replace',
      targetType: 'user',
      targetId: 'u-target',
      targetLabel: 'kim',
      before: [{ roleId: 'r-intern', name: 'intern', expiresAt: null }],
      after: [{ roleId: 'r-admin', name: 'admin', expiresAt: null }],
    });
  });

  it('writes nothing when nothing changed', async () => {
    held({ role: 'intern' });
    await manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports an unknown user and an unknown role', async () => {
    held();
    roles.findUser.mockResolvedValueOnce(null);
    await expect(manager.replaceStaff(master, 'u-x', [])).rejects.toBeInstanceOf(NotFoundError);
    await expect(manager.replaceAll(master, 'u-target', ['r-nope'])).rejects.toBeInstanceOf(BadRequestError);
  });

  it('adds a role to several people and updates the end date of someone who already has it', async () => {
    roles.assignmentsOf
      .mockResolvedValueOnce([{ ...ROLES.intern, assignedAt: at, expiresAt: null, tenantId: '1' }])
      .mockResolvedValueOnce([]);
    roles.findUser
      .mockResolvedValueOnce({ id: 'u-1', loginId: 'one', username: '1', tenantId: '1' })
      .mockResolvedValueOnce({ id: 'u-2', loginId: 'two', username: '2', tenantId: '1' });
    await manager.addMembers(master, 'r-intern', ['u-1', 'u-2'], '2099-01-01');
    expect(roles.updateExpiry).toHaveBeenCalledWith('u-1', '1', 'r-intern', new Date('2099-01-01T14:59:59.999Z'), tx);
    expect(roles.insertAssignments).toHaveBeenCalledWith(
      'u-2',
      '1',
      [{ roleId: 'r-intern', expiresAt: new Date('2099-01-01T14:59:59.999Z') }],
      tx,
    );
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  describe('tenant of a grant — the account\'s tenant (ADR-0056)', () => {
    const accountOf = (tenantId: string | null) =>
      roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: true, tenantId });

    it('refuses a staff role for an account of another tenant', async () => {
      held();
      accountOf('2');
      await expect(
        manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]),
      ).rejects.toBeInstanceOf(IamNotAccountTenantError);
      expect(roles.insertAssignments).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses a customer role for an account of another tenant too — the account is not ours', async () => {
      held();
      accountOf('2');
      await expect(manager.replaceAll(master, 'u-target', ['r-membership'])).rejects.toBeInstanceOf(
        IamNotAccountTenantError,
      );
      expect(roles.insertAssignments).not.toHaveBeenCalled();
    });

    it('refuses to extend an expired role of an account of another tenant', async () => {
      held({ role: 'intern', expiresAt: new Date('2000-01-01T00:00:00Z') });
      accountOf('2');
      await expect(
        manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: '2099-01-01' }]),
      ).rejects.toBeInstanceOf(IamNotAccountTenantError);
      expect(roles.updateExpiry).not.toHaveBeenCalled();
    });

    it('refuses an account that does not know its tenant — there is no default tenant', async () => {
      held();
      accountOf(null);
      await expect(
        manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]),
      ).rejects.toBeInstanceOf(IamNotAccountTenantError);
    });

    it('gives the role to an account of the tenant — there are no memberships to look at', async () => {
      held();
      await manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]);
      expect(roles.insertAssignments).toHaveBeenCalledWith(
        'u-target',
        '1',
        [{ roleId: 'r-intern', expiresAt: null }],
        tx,
      );
    });

    it('lets a stray grant in this tenant be taken away from an account of another tenant', async () => {
      held({ role: 'intern' });
      accountOf('2');
      await manager.removeMember(master, 'r-intern', 'u-target');
      expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', ['r-intern'], tx);
    });

    it('lets the master of another tenant manage the staff of that tenant, in that tenant', async () => {
      const tenantMaster = { ...master, userId: 'u-boss2', loginId: 'boss2', tenantId: '7' };
      roles.activeRoleNamesOf.mockResolvedValue(['master']);
      held();
      accountOf('7');
      await manager.replaceStaff(tenantMaster, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]);
      expect(roles.insertAssignments).toHaveBeenCalledWith(
        'u-target',
        '7',
        [{ roleId: 'r-intern', expiresAt: null }],
        tx,
      );
      expect(audit.record).toHaveBeenCalledWith(tx, tenantMaster, expect.objectContaining({ tenantId: '7' }));
    });

    it('refuses the master of another tenant on an account of tenant 1', async () => {
      const tenantMaster = { ...master, userId: 'u-boss2', loginId: 'boss2', tenantId: '7' };
      roles.activeRoleNamesOf.mockResolvedValue(['master']);
      held();
      await expect(
        manager.addMembers(tenantMaster, 'r-intern', ['u-target'], null),
      ).rejects.toBeInstanceOf(IamNotAccountTenantError);
      expect(roles.insertAssignments).not.toHaveBeenCalled();
    });

    it('leaves grants from another tenant alone when replacing everything', async () => {
      held({ role: 'admin', tenantId: '2' }, { role: 'membership' });
      await manager.replaceAll(master, 'u-target', []);
      expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', ['r-membership'], tx);
    });

    it('refuses a role the account already holds in another tenant', async () => {
      held({ role: 'intern', tenantId: '2' });
      await expect(
        manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]),
      ).rejects.toBeInstanceOf(IamGrantedElsewhereError);
    });

    it('refuses to act when the tenant the actor works in cannot be told', async () => {
      held();
      tenancy.accountTenantOf.mockResolvedValue(null);
      await expect(
        manager.replaceStaff(master, 'u-target', [{ roleId: 'r-intern', expiresAt: null }]),
      ).rejects.toBeInstanceOf(IamTenantUnresolvedError);
    });

    it('gives a new staff account its first role in the account tenant', async () => {
      await manager.assignOnCreate(tx as never, master, 'u-target', 'r-intern', '1');
      expect(roles.insertAssignments).toHaveBeenCalledWith(
        'u-target',
        '1',
        [{ roleId: 'r-intern', expiresAt: null }],
        tx,
      );
    });

    it('refuses the first role of a new account in a tenant that is not the account\'s', async () => {
      accountOf('1');
      await expect(manager.assignOnCreate(tx as never, master, 'u-target', 'r-intern', '7')).rejects.toBeInstanceOf(
        IamNotAccountTenantError,
      );
    });
  });

  describe('assertNotStaff', () => {
    it('rejects a withdrawal while a staff role is live', async () => {
      roles.hasLiveStaffRole.mockResolvedValue(true);
      await expect(manager.assertNotStaff('u-target', tx as never)).rejects.toBeInstanceOf(IamStaffCannotLeaveError);
      expect(roles.hasLiveStaffRole).toHaveBeenCalledWith('u-target', tx);
    });

    it('lets a former staff member withdraw once the role has ended', async () => {
      roles.hasLiveStaffRole.mockResolvedValue(false);
      await expect(manager.assertNotStaff('u-target')).resolves.toBeUndefined();
    });

    it('lets a customer withdraw', async () => {
      roles.hasLiveStaffRole.mockResolvedValue(false);
      held({ role: 'membership' });
      await expect(manager.assertNotStaff('u-target')).resolves.toBeUndefined();
    });
  });

  describe('an operator works in its own tenant too (ADR-0056)', () => {
    it("refuses giving an operator's role to an account of another tenant — no «work in the named tenant»", async () => {
      held();
      roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: true, tenantId: 't2' });
      await expect(manager.addMembers(master, 'r-intern', ['u-target'], null)).rejects.toBeInstanceOf(
        IamNotAccountTenantError,
      );
      expect(roles.insertAssignments).not.toHaveBeenCalled();
    });

    it("takes a role away only in the operator's tenant, leaving the other tenant's grant", async () => {
      held({ role: 'intern', tenantId: 't2' }, { role: 'intern', tenantId: '1' });
      await manager.removeMember(master, 'r-intern', 'u-target');
      expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', '1', ['r-intern'], tx);
      expect(roles.deleteAssignments).not.toHaveBeenCalledWith('u-target', 't2', expect.anything(), tx);
    });

    it('makes a new account belong to the tenant the actor works in, operator or not', async () => {
      await expect(manager.tenantForNewAccount(master, tx as never)).resolves.toBe('1');
      await expect(manager.tenantForNewAccount(adminActor, tx as never)).resolves.toBe('1');
    });

    it("sets up a tenant's first master in that tenant, keeping that tenant's other grants (the operator API's own path)", async () => {
      held({ role: 'intern', tenantId: 't2' });
      roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: true, tenantId: 't2' });
      await manager.grantInTenant(tx as never, master, 'u-target', 'r-master', 't2');
      expect(roles.insertAssignments).toHaveBeenCalledWith(
        'u-target',
        't2',
        [{ roleId: 'r-master', expiresAt: null }],
        tx,
      );
      expect(roles.deleteAssignments).not.toHaveBeenCalledWith('u-target', 't2', ['r-intern'], tx);
      expect(audit.record).toHaveBeenCalledWith(tx, master, expect.objectContaining({ tenantId: 't2' }));
    });

    it("refuses a first master that is an account of another tenant", async () => {
      held();
      await expect(manager.grantInTenant(tx as never, master, 'u-target', 'r-master', 't2')).rejects.toBeInstanceOf(
        IamNotAccountTenantError,
      );
    });

    it('gives the first role in the tenant the account was made in', async () => {
      roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: true, tenantId: 't2' });
      await manager.assignOnCreate(tx as never, master, 'u-target', 'r-intern', 't2');
      expect(roles.insertAssignments).toHaveBeenCalledWith(
        'u-target',
        't2',
        [{ roleId: 'r-intern', expiresAt: null }],
        tx,
      );
    });
  });
});
