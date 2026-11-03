import { DbService } from '@app/db';
import { createCheckpointsForTesting, PermissionCheckpoints } from '@app/authorization';
import { ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { userServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { RoleAssignmentManager } from '../../iam/assignments/role-assignment.manager';
import { StaffPasswordManager } from '../../iam/staff/staff-password.manager';
import { PlatformOperatorManager } from '../../iam/tenancy/platform-operator.manager';
import { UsersService } from '../../users/users.service';
import { SERVED_TENANT_ID } from '../../../tenancy/served-tenant';
import { AuthService } from './auth.service';

describe('AuthService.changePassword', () => {
  const where = jest.fn();
  const db = { update: jest.fn(() => ({ set: jest.fn(() => ({ where })) })) };
  const usersService = { findUserByLoginIdInTenant: jest.fn(), getUserRoleNames: jest.fn() };
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
        { provide: PlatformOperatorManager, useValue: { assertOperator: jest.fn() } },
        { provide: StaffPasswordManager, useValue: { reissue: jest.fn() } },
        { provide: SERVED_TENANT_ID, useValue: 'T' },
        { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting(byRole) },
      ],
    }).compile();
    return module.get(AuthService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    usersService.findUserByLoginIdInTenant.mockImplementation(async (tenantId: string) =>
      tenantId === 'T' ? { id: 'u-1', loginId: 'target' } : null,
    );
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
    usersService.findUserByLoginIdInTenant.mockResolvedValue(null);
    await expect(service.changePassword(request, master)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('looks for the account only in the served tenant — another tenant\'s account with the same login id is not found (ADR-0056)', async () => {
    await service.changePassword(request, master);
    expect(usersService.findUserByLoginIdInTenant).toHaveBeenCalledWith('T', 'target');
    usersService.findUserByLoginIdInTenant.mockResolvedValue(null);
    await expect(service.changePassword(request, master)).rejects.toBeInstanceOf(NotFoundError);
    expect(where).toHaveBeenCalledTimes(1);
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
    findUserByLoginIdInTenant: jest.fn(),
    findUserByEmailInTenant: jest.fn(),
    updateMyProfile: jest.fn(),
    assignUserRole: jest.fn(),
  };
  const assignments = { assignOnCreate: jest.fn(), tenantForNewAccount: async () => '1' };
  const actor = { userId: 'u-boss', loginId: 'boss', roles: ['master'], userAgent: null, requestId: null, ip: null };
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    usersService.findUserByLoginIdInTenant.mockResolvedValue(null);
    usersService.findUserByEmailInTenant.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DbService, useValue: { run } },
        { provide: UsersService, useValue: usersService },
        { provide: RoleAssignmentManager, useValue: assignments },
        { provide: PlatformOperatorManager, useValue: { assertOperator: jest.fn() } },
        { provide: StaffPasswordManager, useValue: { reissue: jest.fn() } },
        { provide: SERVED_TENANT_ID, useValue: 'T' },
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
    expect(assignments.assignOnCreate).toHaveBeenCalledWith(tx, actor, 'u-new', 'r-intern', '1');
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

describe('AuthService.createAccount — 운영자가 대행해 만드는 직원 계정', () => {
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    insert: jest.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return {
          returning: async () => {
            if (insertFails) throw insertFails;
            return [{ id: 'u-new', loginId: values.loginId, email: values.email, username: 'x' }];
          },
        };
      },
    })),
  };
  // drizzle 이 postgres.js 의 unique 위반을 cause 로 감싸 던지는 꼴.
  let insertFails: Error | null = null;
  const uniqueViolation = (constraint: string) =>
    Object.assign(new Error('insert failed'), { cause: { code: '23505', constraint_name: constraint } });
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  const usersService = {
    findUserByLoginIdInTenant: jest.fn(),
    findUserByEmailInTenant: jest.fn(),
    updateMyProfile: jest.fn(),
  };
  const roleAssignments = { assignOnCreate: jest.fn(), tenantForNewAccount: jest.fn() };
  const operators = { assertOperator: jest.fn() };
  const actor = { userId: 'u-op', loginId: 'op', roles: ['master'], userAgent: null, requestId: null, ip: null };
  const dto = {
    username: '홍길동',
    nickname: '홍길동',
    loginId: 'staff1',
    email: 'staff1@example.test',
    roleId: 'r-staff',
  };
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    inserted.length = 0;
    insertFails = null;
    usersService.findUserByLoginIdInTenant.mockResolvedValue(null);
    usersService.findUserByEmailInTenant.mockResolvedValue(null);
    // 이름 없는 요청은 요청자의 테넌트(여기선 '1'), 이름이 있으면 그 테넌트 — 운영자만 된다는 판정은 iam Manager 의 몫이다.
    roleAssignments.tenantForNewAccount.mockImplementation(async (_actor: unknown, requested?: string) => requested ?? '1');
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DbService, useValue: { run } },
        { provide: UsersService, useValue: usersService },
        { provide: RoleAssignmentManager, useValue: roleAssignments },
        { provide: PlatformOperatorManager, useValue: operators },
        { provide: StaffPasswordManager, useValue: { reissue: jest.fn() } },
        { provide: SERVED_TENANT_ID, useValue: 'T' },
        { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting({}) },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('forces a password change by default and gives the first role in the actor tenant', async () => {
    const { initialPassword } = await service.createAccount(dto, actor);
    expect(initialPassword).toHaveLength(16);
    expect(inserted[0].values).toMatchObject({ loginId: 'staff1', mustChangePassword: true });
    expect(roleAssignments.assignOnCreate).toHaveBeenCalledWith(tx, actor, 'u-new', 'r-staff', '1');
    expect(operators.assertOperator).not.toHaveBeenCalled();
  });

  it('makes the account belong to the tenant the actor works in when none is named', async () => {
    await service.createAccount(dto, actor);
    expect(roleAssignments.tenantForNewAccount).toHaveBeenCalledWith(actor, undefined, tx);
    expect(inserted[0].values).toMatchObject({ loginId: 'staff1', tenantId: '1' });
  });

  it('makes the account belong to a named tenant, and gives its first role there (the first master)', async () => {
    await service.createAccount({ ...dto, tenantId: 't2' }, actor);
    expect(roleAssignments.tenantForNewAccount).toHaveBeenCalledWith(actor, 't2', tx);
    expect(inserted[0].values).toMatchObject({ tenantId: 't2' });
    expect(roleAssignments.assignOnCreate).toHaveBeenCalledWith(tx, actor, 'u-new', 'r-staff', 't2');
  });

  it('creates nothing when the actor may not work in the named tenant', async () => {
    roleAssignments.tenantForNewAccount.mockRejectedValueOnce(new ForbiddenError('operators only'));
    await expect(service.createAccount({ ...dto, tenantId: 't2' }, actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect(inserted).toEqual([]);
    expect(roleAssignments.assignOnCreate).not.toHaveBeenCalled();
  });

  it('leaves the change unforced only for an operator (the check account)', async () => {
    await service.createAccount({ ...dto, tenantId: 't2', forcePasswordChange: false }, actor);
    expect(operators.assertOperator).toHaveBeenCalledWith(actor, tx);
    expect(inserted[0].values).toMatchObject({ mustChangePassword: false });
  });

  describe('duplicates are judged within the tenant the account will belong to (ADR-0056)', () => {
    it('looks for the login id and the email only among accounts of that tenant', async () => {
      roleAssignments.tenantForNewAccount.mockResolvedValue('7');
      await service.createAccount(dto, actor);
      expect(usersService.findUserByLoginIdInTenant).toHaveBeenCalledWith('7', 'staff1', tx);
      expect(usersService.findUserByEmailInTenant).toHaveBeenCalledWith('7', 'staff1@example.test', tx);
    });

    it('refuses a login id or an email already used in the tenant', async () => {
      usersService.findUserByLoginIdInTenant.mockResolvedValueOnce({ id: 'u-old' });
      await expect(service.createAccount(dto, actor)).rejects.toThrow(
        new ConflictError('이미 존재하는 로그인 ID 입니다.'),
      );
      usersService.findUserByEmailInTenant.mockResolvedValueOnce({ id: 'u-old' });
      await expect(service.createAccount(dto, actor)).rejects.toThrow(new ConflictError('이미 존재하는 이메일 입니다.'));
      expect(inserted).toEqual([]);
    });

    it('answers the same 409 when another tenant holds the value and the unique is still global', async () => {
      insertFails = uniqueViolation('users_login_id_unique');
      await expect(service.createAccount(dto, actor)).rejects.toThrow(
        new ConflictError('이미 존재하는 로그인 ID 입니다.'),
      );
      insertFails = uniqueViolation('users_email_unique');
      await expect(service.createAccount(dto, actor)).rejects.toThrow(new ConflictError('이미 존재하는 이메일 입니다.'));
      expect(roleAssignments.assignOnCreate).not.toHaveBeenCalled();
    });

    it('lets any other insert failure through as it is', async () => {
      insertFails = new Error('connection lost');
      await expect(service.createAccount(dto, actor)).rejects.toThrow('connection lost');
    });
  });

  it('writes only the account row — no UserCreated (a customer sign-up event) goes out', async () => {
    await service.createAccount({ ...dto, tenantId: 't2' }, actor);
    expect(inserted.map((i) => i.table)).toEqual([userServiceSchema.users]);
  });
});
