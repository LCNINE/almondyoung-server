import { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import { IamEscalationError, IamLastMasterError, IamSelfChangeError } from '../iam.errors';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository } from '../roles/role.repository';
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
  master: ['a.b.read', 'a.b.write', 'c.d.read'],
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
  };
  const audit = { record: jest.fn() };
  const myPermissions = { forRoles: jest.fn() };
  const snapshots = { snapshot: jest.fn() };
  const tx = { marker: 'tx' };
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  const master = { userId: 'u-boss', loginId: 'boss', roles: ['master'], userAgent: null, requestId: null };
  const adminActor = { userId: 'u-adm', loginId: 'adm', roles: ['admin'], userAgent: null, requestId: null };
  let manager: RoleAssignmentManager;

  beforeEach(async () => {
    jest.resetAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    snapshots.snapshot.mockResolvedValue({ version: 'v', roles: GRANTS });
    myPermissions.forRoles.mockImplementation(async (names: string[]) => ({
      permissions: [...new Set(names.flatMap((n) => GRANTS[n] ?? []))],
    }));
    roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: true });
    roles.findRolesByIds.mockImplementation(async (ids: readonly string[]) =>
      ALL.filter((r) => ids.includes(r.roleId)),
    );
    roles.findRoleByName.mockResolvedValue(ALL[0]);
    roles.lockRole.mockResolvedValue(ALL[0]);
    roles.countPermanentHolders.mockResolvedValue(1);
    roles.activeRoleNamesOf.mockImplementation(async (userId: string) =>
      userId === master.userId ? ['master'] : userId === adminActor.userId ? ['admin'] : [],
    );
    const module = await Test.createTestingModule({
      providers: [
        RoleAssignmentManager,
        { provide: RoleRepository, useValue: roles },
        { provide: IamAuditCreator, useValue: audit },
        { provide: MyPermissionsReader, useValue: myPermissions },
        { provide: RolePermissionsReader, useValue: snapshots },
        { provide: DbService, useValue: { run } },
      ],
    }).compile();
    manager = module.get(RoleAssignmentManager);
  });

  const held = (...rows: { role: keyof typeof ROLES; expiresAt?: Date | null }[]) =>
    roles.assignmentsOf.mockResolvedValue(
      rows.map(({ role, expiresAt }) => ({ ...ROLES[role], assignedAt: at, expiresAt: expiresAt ?? null })),
    );

  it('keeps the end date of an assignment it did not change', async () => {
    held({ role: 'intern', expiresAt: new Date('2099-12-31T14:59:59.999Z') }, { role: 'membership' });
    await manager.replaceAll(master, 'u-target', ['r-intern', 'r-membership', 'r-admin']);
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', [], tx);
    expect(roles.updateExpiry).not.toHaveBeenCalled();
    expect(roles.insertAssignments).toHaveBeenCalledWith('u-target', [{ roleId: 'r-admin', expiresAt: null }], tx);
  });

  it('keeps the full replace contract for the customer screen', async () => {
    held({ role: 'membership' }, { role: 'intern' });
    await manager.replaceAll(master, 'u-target', ['r-intern']);
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', ['r-membership'], tx);
  });

  it('leaves customer roles alone when only staff roles are edited', async () => {
    held({ role: 'membership' }, { role: 'intern' });
    await manager.replaceStaff(master, 'u-target', [{ roleId: 'r-admin', expiresAt: null }]);
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', ['r-intern'], tx);
    expect(roles.insertAssignments).toHaveBeenCalledWith('u-target', [{ roleId: 'r-admin', expiresAt: null }], tx);
  });

  it('refuses to change your own roles', async () => {
    held();
    roles.findUser.mockResolvedValue({ id: 'u-boss', loginId: 'boss', username: '보스', canSignIn: true });
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

  it('lets anyone who can assign roles hand out a customer role', async () => {
    held();
    await manager.replaceAll(adminActor, 'u-target', ['r-membership']);
    expect(roles.insertAssignments).toHaveBeenCalledWith('u-target', [{ roleId: 'r-membership', expiresAt: null }], tx);
  });

  it('keeps at least one permanent holder of the system role', async () => {
    held({ role: 'master' });
    roles.countPermanentHolders.mockResolvedValue(0);
    await expect(manager.replaceStaff(master, 'u-target', [])).rejects.toBeInstanceOf(IamLastMasterError);
  });

  it('does not count a time-limited system role as the one that remains', async () => {
    held({ role: 'master' });
    roles.countPermanentHolders.mockResolvedValue(0);
    await expect(
      manager.replaceStaff(master, 'u-target', [{ roleId: 'r-master', expiresAt: '2099-01-01' }]),
    ).rejects.toBeInstanceOf(IamLastMasterError);
  });

  it('counts the other holders without the person being changed', async () => {
    held({ role: 'master' });
    await manager.replaceStaff(master, 'u-target', []);
    expect(roles.countPermanentHolders).toHaveBeenCalledWith('r-master', tx, 'u-target');
  });

  it('lets a dormant holder lose the system role while another holder remains', async () => {
    held({ role: 'master' });
    roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: false });
    roles.countPermanentHolders.mockResolvedValue(1);
    await expect(manager.replaceStaff(master, 'u-target', [])).resolves.toBeUndefined();
  });

  it('does not count a dormant person as the holder that remains', async () => {
    held({ role: 'master', expiresAt: new Date('2099-12-31T14:59:59.999Z') });
    roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: false });
    roles.countPermanentHolders.mockResolvedValue(0);
    await expect(
      manager.replaceStaff(master, 'u-target', [{ roleId: 'r-master', expiresAt: null }]),
    ).rejects.toBeInstanceOf(IamLastMasterError);
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
    expect(roles.deleteAssignments).toHaveBeenCalledWith('u-target', [], tx);
    expect(roles.updateExpiry).toHaveBeenCalledWith('u-target', 'r-admin', endOfKoreanDay('2099-01-01'), tx);
  });

  it('takes a role named twice in one request as one assignment', async () => {
    held();
    await manager.replaceStaff(master, 'u-target', [
      { roleId: 'r-intern', expiresAt: null },
      { roleId: 'r-intern', expiresAt: '2099-01-01' },
    ]);
    expect(roles.insertAssignments).toHaveBeenCalledWith(
      'u-target',
      [{ roleId: 'r-intern', expiresAt: endOfKoreanDay('2099-01-01') }],
      tx,
    );
  });

  it('locks the system role before counting its holders', async () => {
    held({ role: 'master' });
    await manager.replaceStaff(master, 'u-target', []);
    expect(roles.lockRole.mock.invocationCallOrder[0]).toBeLessThan(
      roles.countPermanentHolders.mock.invocationCallOrder[0],
    );
  });

  it('does not touch the system role lock when the system role is not involved', async () => {
    held({ role: 'intern' });
    await manager.replaceStaff(master, 'u-target', []);
    expect(roles.lockRole).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce([{ ...ROLES.intern, assignedAt: at, expiresAt: null }])
      .mockResolvedValueOnce([]);
    roles.findUser
      .mockResolvedValueOnce({ id: 'u-1', loginId: 'one', username: '1' })
      .mockResolvedValueOnce({ id: 'u-2', loginId: 'two', username: '2' });
    await manager.addMembers(master, 'r-intern', ['u-1', 'u-2'], '2099-01-01');
    expect(roles.updateExpiry).toHaveBeenCalledWith('u-1', 'r-intern', new Date('2099-01-01T14:59:59.999Z'), tx);
    expect(roles.insertAssignments).toHaveBeenCalledWith(
      'u-2',
      [{ roleId: 'r-intern', expiresAt: new Date('2099-01-01T14:59:59.999Z') }],
      tx,
    );
    expect(audit.record).toHaveBeenCalledTimes(2);
  });
});
