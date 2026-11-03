import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { GrantAuthority } from '../assignments/grant-authority';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import {
  IamEscalationError,
  IamNotAccountTenantError,
  IamOperatorOnlyError,
  IamSelfChangeError,
} from '../iam.errors';
import { MyPermissionsReader } from '../my-permissions.reader';
import { PlatformRepository } from '../platform/platform.repository';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { StaffPasswordManager } from './staff-password.manager';

const GRANTS: Record<string, string[]> = {
  master: ['a.b.read', 'a.b.write', 'iam.admin_user.write', 'customer.profile.write'],
  admin: ['a.b.read', 'a.b.write'],
  intern: ['a.b.read'],
};

describe('StaffPasswordManager — 테넌트 master 가 자기 직원의 비밀번호를 초기화한다', () => {
  const roles = { findUser: jest.fn(), activeRoleNamesOf: jest.fn(), hasLiveStaffRole: jest.fn() };
  const tenancy = { tenantsOf: jest.fn(), isOperator: jest.fn() };
  const platform = { setPassword: jest.fn(), revokeUserSessions: jest.fn() };
  const audit = { record: jest.fn() };
  const myPermissions = { forRoles: jest.fn() };
  const snapshots = { snapshot: jest.fn() };
  const tx = { marker: 'tx' };
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  // 테넌트 7 의 master — 운영자가 아니다.
  const tenantMaster = {
    userId: 'u-boss',
    loginId: 'boss',
    roles: ['master'],
    userAgent: null,
    requestId: null,
    ip: null,
    tenantId: '7',
  };
  const targetRoles: Record<string, string[]> = {};
  let manager: StaffPasswordManager;

  const account = (over: Partial<{ id: string; tenantId: string | null }> = {}) =>
    roles.findUser.mockResolvedValue({
      id: 'u-staff',
      loginId: 'kim',
      username: '김',
      canSignIn: true,
      tenantId: '7',
      ...over,
    });

  beforeEach(async () => {
    jest.resetAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    snapshots.snapshot.mockResolvedValue({ version: 'v', roles: GRANTS });
    myPermissions.forRoles.mockImplementation(async (names: string[]) => ({
      permissions: [...new Set(names.flatMap((n) => GRANTS[n] ?? []))],
    }));
    for (const key of Object.keys(targetRoles)) delete targetRoles[key];
    targetRoles['u-boss'] = ['master'];
    targetRoles['u-staff'] = ['intern'];
    roles.activeRoleNamesOf.mockImplementation(async (userId: string) => targetRoles[userId] ?? []);
    tenancy.isOperator.mockResolvedValue(false);
    roles.hasLiveStaffRole.mockResolvedValue(true);
    account();
    const module = await Test.createTestingModule({
      providers: [
        StaffPasswordManager,
        GrantAuthority,
        ActorTenantReader,
        PlatformOperatorManager,
        { provide: RoleRepository, useValue: roles },
        { provide: TenancyRepository, useValue: tenancy },
        { provide: PlatformRepository, useValue: platform },
        { provide: IamAuditCreator, useValue: audit },
        { provide: MyPermissionsReader, useValue: myPermissions },
        { provide: RolePermissionsReader, useValue: snapshots },
        { provide: DbService, useValue: { run } },
      ],
    }).compile();
    manager = module.get(StaffPasswordManager);
  });

  it('gives an account of the tenant a new initial password once, forces a change at next sign-in and cuts its sessions', async () => {
    const { initialPassword } = await manager.reissue(tenantMaster, 'u-staff');

    expect(initialPassword).toHaveLength(16);
    const [userId, hash, mustChange] = platform.setPassword.mock.calls[0];
    expect(userId).toBe('u-staff');
    expect(await bcrypt.compare(initialPassword, hash)).toBe(true);
    expect(mustChange).toBe(true);
    expect(platform.revokeUserSessions).toHaveBeenCalledWith('u-staff', tx);
  });

  it('writes the history under the tenant, without the password', async () => {
    const { initialPassword } = await manager.reissue(tenantMaster, 'u-staff');
    expect(audit.record).toHaveBeenCalledWith(tx, tenantMaster, {
      tenantId: '7',
      action: 'user.password.reissue',
      targetType: 'user',
      targetId: 'u-staff',
      targetLabel: 'kim',
      before: null,
      after: { mustChangePassword: true },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(initialPassword);
  });

  it('refuses an account of another tenant — and says nothing more about it', async () => {
    account({ tenantId: '1' });
    await expect(manager.reissue(tenantMaster, 'u-staff')).rejects.toBeInstanceOf(IamNotAccountTenantError);
    expect(platform.setPassword).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses an account that does not know its tenant', async () => {
    account({ tenantId: null });
    await expect(manager.reissue(tenantMaster, 'u-staff')).rejects.toBeInstanceOf(IamNotAccountTenantError);
  });

  it('refuses your own account — change your own password instead', async () => {
    account({ id: 'u-boss' });
    await expect(manager.reissue(tenantMaster, 'u-boss')).rejects.toBeInstanceOf(IamSelfChangeError);
    expect(platform.setPassword).not.toHaveBeenCalled();
  });

  it('refuses an account whose roles the actor could not give — no taking over a higher account', async () => {
    const admin = { ...tenantMaster, userId: 'u-adm', roles: ['admin'] };
    targetRoles['u-adm'] = ['admin'];
    targetRoles['u-staff'] = ['master'];
    await expect(manager.reissue(admin, 'u-staff')).rejects.toBeInstanceOf(IamEscalationError);
    expect(platform.setPassword).not.toHaveBeenCalled();
  });

  it("lets an admin reset someone whose roles the admin holds the permissions of", async () => {
    const admin = { ...tenantMaster, userId: 'u-adm', roles: ['admin'] };
    targetRoles['u-adm'] = ['admin'];
    await expect(manager.reissue(admin, 'u-staff')).resolves.toMatchObject({ initialPassword: expect.any(String) });
  });

  it('refuses an account without a live staff role — a customer password is not this route\'s', async () => {
    roles.hasLiveStaffRole.mockResolvedValue(false);
    targetRoles['u-staff'] = ['user'];
    await expect(manager.reissue(tenantMaster, 'u-staff')).rejects.toBeInstanceOf(NotFoundError);
    expect(roles.hasLiveStaffRole).toHaveBeenCalledWith('u-staff', tx);
    expect(platform.setPassword).not.toHaveBeenCalled();
  });

  it('refuses a platform operator account unless the actor is one too', async () => {
    tenancy.isOperator.mockImplementation(async (userId: string) => userId === 'u-staff');
    await expect(manager.reissue(tenantMaster, 'u-staff')).rejects.toBeInstanceOf(IamOperatorOnlyError);
    expect(platform.setPassword).not.toHaveBeenCalled();
  });

  it('works in tenant 1 for tenant 1 the same way', async () => {
    account({ tenantId: '1' });
    await manager.reissue({ ...tenantMaster, tenantId: '1' }, 'u-staff');
    expect(audit.record).toHaveBeenCalledWith(tx, expect.anything(), expect.objectContaining({ tenantId: '1' }));
  });

  it('reports an unknown account', async () => {
    roles.findUser.mockResolvedValue(null);
    await expect(manager.reissue(tenantMaster, 'u-nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
