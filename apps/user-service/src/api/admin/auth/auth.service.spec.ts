import { DbService } from '@app/db';
import {
  checkpointEvaluations,
  createCheckpointsForTesting,
  PermissionCheckpoints,
  ScopeGuard,
} from '@app/authorization';
import { register } from 'prom-client';
import { ForbiddenError, NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { UsersService } from '../../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService.changePassword', () => {
  const where = jest.fn();
  const db = { update: jest.fn(() => ({ set: jest.fn(() => ({ where })) })) };
  const usersService = { findUserByLoginId: jest.fn(), getUserRoleNames: jest.fn() };
  const scopeGuard = { getGrantedScopes: jest.fn() };
  let service: AuthService;

  const admin = { roles: ['admin'] };
  const master = { roles: ['master'] };
  const request = { loginId: 'target', newPassword: 'Passw0rd!' };

  beforeEach(async () => {
    jest.clearAllMocks();
    register.resetMetrics();
    usersService.findUserByLoginId.mockResolvedValue({ id: 'u-1', loginId: 'target' });
    scopeGuard.getGrantedScopes.mockImplementation(async (user: { roles: string[] }) =>
      user.roles.includes('master') ? ['master'] : [],
    );
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DbService, useValue: { db } },
        { provide: UsersService, useValue: usersService },
        { provide: ScopeGuard, useValue: scopeGuard },
        {
          provide: PermissionCheckpoints,
          useValue: createCheckpointsForTesting({ master: ['iam.admin_user.write'], admin: [] }),
        },
      ],
    }).compile();
    service = module.get(AuthService);
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
    expect(scopeGuard.getGrantedScopes).toHaveBeenCalledWith(master, ['master']);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown login id as not found', async () => {
    usersService.findUserByLoginId.mockResolvedValue(undefined);
    await expect(service.changePassword(request, master)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('compares the staff password rule with the account management permission', async () => {
    usersService.getUserRoleNames.mockResolvedValue(['logistics_manager']);
    await expect(service.changePassword(request, admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.changePassword(request, master)).resolves.toEqual({ message: '비밀번호가 변경되었습니다.' });
    expect(await checkpointEvaluations('iam.staff_password_reset', 'match')).toBe(2);
  });

  it('does not compare anything for a customer account', async () => {
    usersService.getUserRoleNames.mockResolvedValue(['user']);
    await service.changePassword(request, admin);
    expect(await checkpointEvaluations('iam.staff_password_reset', 'match')).toBe(0);
  });
});
