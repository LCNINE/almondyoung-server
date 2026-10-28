import { DbService } from '@app/db';
import { createCheckpointsForTesting, PermissionCheckpoints } from '@app/authorization';
import { ForbiddenError, NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { RoleAssignmentManager } from '../../iam/assignments/role-assignment.manager';
import { UsersService } from '../../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService.changePassword', () => {
  const where = jest.fn();
  const db = { update: jest.fn(() => ({ set: jest.fn(() => ({ where })) })) };
  const usersService = { findUserByLoginId: jest.fn(), getUserRoleNames: jest.fn() };
  let service: AuthService;

  const admin = { roles: ['admin'] };
  const master = { roles: ['master'] };
  const request = { loginId: 'target', newPassword: 'Passw0rd!' };

  async function serviceWith(byRole?: Readonly<Record<string, readonly string[]>> | null): Promise<AuthService> {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DbService, useValue: { db } },
        { provide: UsersService, useValue: usersService },
        { provide: RoleAssignmentManager, useValue: { assignOnCreate: jest.fn() } },
        { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting(byRole) },
      ],
    }).compile();
    return module.get(AuthService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    usersService.findUserByLoginId.mockResolvedValue({ id: 'u-1', loginId: 'target' });
    service = await serviceWith({ master: ['iam.admin_user.write'], admin: [] });
  });

  it('lets an account manager reset a customer password', async () => {
    usersService.getUserRoleNames.mockResolvedValue(['user', 'membership']);
    await expect(service.changePassword(request, admin)).resolves.toEqual({ message: '비밀번호가 변경되었습니다.' });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('treats an account without roles as a customer', async () => {
    usersService.getUserRoleNames.mockResolvedValue([]);
    await expect(service.changePassword(request, admin)).resolves.toBeDefined();
    expect(where).toHaveBeenCalledTimes(1);
  });

  it.each([['admin'], ['master'], ['logistics_manager'], ['intern']])(
    'requires the account-creation authority to reset a staff account (%s)',
    async (role) => {
      usersService.getUserRoleNames.mockResolvedValue(['user', role]);
      await expect(service.changePassword(request, admin)).rejects.toBeInstanceOf(ForbiddenError);
      expect(where).not.toHaveBeenCalled();
    },
  );

  it('lets the account-creation authority reset a staff account', async () => {
    usersService.getUserRoleNames.mockResolvedValue(['admin']);
    await expect(service.changePassword(request, master)).resolves.toBeDefined();
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown login id as not found', async () => {
    usersService.findUserByLoginId.mockResolvedValue(undefined);
    await expect(service.changePassword(request, master)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not let an old role name alone reset a staff account', async () => {
    usersService.getUserRoleNames.mockResolvedValue(['logistics_manager']);
    service = await serviceWith({ master: [] });
    await expect(service.changePassword(request, master)).rejects.toBeInstanceOf(ForbiddenError);
    expect(where).not.toHaveBeenCalled();
  });

  it('lets any role holding the account management permission reset a staff account', async () => {
    usersService.getUserRoleNames.mockResolvedValue(['logistics_manager']);
    service = await serviceWith({ hr: ['iam.admin_user.write'] });
    await expect(service.changePassword(request, { roles: ['hr'] })).resolves.toBeDefined();
  });

  it('follows the real first-grant map: master resets a staff account, admin does not', async () => {
    usersService.getUserRoleNames.mockResolvedValue(['logistics_manager']);
    service = await serviceWith();
    await expect(service.changePassword(request, admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.changePassword(request, master)).resolves.toBeDefined();
  });

  it('refuses staff resets before the permission copy arrives, but not customer resets', async () => {
    service = await serviceWith(null);
    usersService.getUserRoleNames.mockResolvedValue(['logistics_manager']);
    await expect(service.changePassword(request, master)).rejects.toBeInstanceOf(ForbiddenError);
    usersService.getUserRoleNames.mockResolvedValue(['user']);
    await expect(service.changePassword(request, admin)).resolves.toBeDefined();
  });
});

describe('AuthService.createAccount', () => {
  const tx = {
    insert: jest.fn(() => ({ values: jest.fn(() => ({ returning: jest.fn(async () => [created]) })) })),
  };
  const created = { id: 'u-new', loginId: 'newbie', email: 'n@e.w', username: '새사람' };
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  const usersService = {
    findUserByLoginId: jest.fn(),
    findUserByEmail: jest.fn(),
    updateMyProfile: jest.fn(),
    assignUserRole: jest.fn(),
  };
  const assignments = { assignOnCreate: jest.fn() };
  const actor = { userId: 'u-boss', loginId: 'boss', roles: ['master'], userAgent: null, requestId: null, ip: null };
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    usersService.findUserByLoginId.mockResolvedValue(null);
    usersService.findUserByEmail.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DbService, useValue: { run } },
        { provide: UsersService, useValue: usersService },
        { provide: RoleAssignmentManager, useValue: assignments },
        { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting({}) },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('gives the first role through the role assignment rules in the same transaction', async () => {
    await service.createAccount(
      { username: '새사람', nickname: '새', loginId: 'newbie', email: 'n@e.w', roleId: 'r-intern' },
      actor,
    );
    expect(assignments.assignOnCreate).toHaveBeenCalledWith(tx, actor, 'u-new', 'r-intern');
    expect(usersService.assignUserRole).not.toHaveBeenCalled();
  });

  it('creates nothing when the role may not be given', async () => {
    assignments.assignOnCreate.mockRejectedValueOnce(new ForbiddenError('no'));
    await expect(
      service.createAccount(
        { username: '새사람', nickname: '새', loginId: 'newbie', email: 'n@e.w', roleId: 'r-master' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(usersService.updateMyProfile).not.toHaveBeenCalled();
  });
});
