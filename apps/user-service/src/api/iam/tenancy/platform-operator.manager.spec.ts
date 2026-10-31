import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import { IamLastOperatorError, IamOperatorOnlyError, IamSelfChangeError } from '../iam.errors';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from './actor-tenant.reader';
import { PlatformOperatorManager } from './platform-operator.manager';
import { TenancyRepository } from './tenancy.repository';

describe('PlatformOperatorManager', () => {
  const tenancy = {
    isOperator: jest.fn(),
    lockOperators: jest.fn(),
    countSignInOperators: jest.fn(),
    setOperator: jest.fn(),
    tenantExists: jest.fn(),
  };
  const roles = { findUser: jest.fn() };
  const audit = { record: jest.fn() };
  const tx = { marker: 'tx' };
  const run = jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx));
  const operator = { userId: 'u-op', loginId: 'op', roles: ['master'], userAgent: null, requestId: null, ip: null };
  let manager: PlatformOperatorManager;

  beforeEach(async () => {
    jest.resetAllMocks();
    run.mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
    tenancy.isOperator.mockImplementation(async (userId: string) => userId === 'u-op' || userId === 'u-target');
    tenancy.countSignInOperators.mockResolvedValue(1);
    roles.findUser.mockResolvedValue({ id: 'u-target', loginId: 'kim', username: '김', canSignIn: true });
    const module = await Test.createTestingModule({
      providers: [
        PlatformOperatorManager,
        { provide: TenancyRepository, useValue: tenancy },
        { provide: RoleRepository, useValue: roles },
        { provide: IamAuditCreator, useValue: audit },
        { provide: DbService, useValue: { run } },
        { provide: ActorTenantReader, useValue: { resolve: async () => '1' } },
      ],
    }).compile();
    manager = module.get(PlatformOperatorManager);
  });

  describe('demoting', () => {
    it('refuses to demote the last operator who can sign in', async () => {
      tenancy.countSignInOperators.mockResolvedValue(0);
      await expect(manager.setOperator(operator, 'u-target', false)).rejects.toBeInstanceOf(IamLastOperatorError);
      expect(tenancy.setOperator).not.toHaveBeenCalled();
    });

    it('locks the operators before counting the ones that remain', async () => {
      await manager.setOperator(operator, 'u-target', false);
      expect(tenancy.countSignInOperators).toHaveBeenCalledWith('u-target', tx);
      expect(tenancy.lockOperators.mock.invocationCallOrder[0]).toBeLessThan(
        tenancy.countSignInOperators.mock.invocationCallOrder[0],
      );
    });

    it('demotes while another operator remains, and writes one history row outside any tenant', async () => {
      await manager.setOperator(operator, 'u-target', false);
      expect(tenancy.setOperator).toHaveBeenCalledWith('u-target', false, tx);
      expect(audit.record).toHaveBeenCalledWith(tx, operator, {
        tenantId: null,
        action: 'user.platform_operator.set',
        targetType: 'user',
        targetId: 'u-target',
        targetLabel: 'kim',
        before: { isPlatformOperator: true },
        after: { isPlatformOperator: false },
      });
    });
  });

  it('only lets an operator change who is an operator', async () => {
    const admin = { ...operator, userId: 'u-adm' };
    await expect(manager.setOperator(admin, 'u-target', false)).rejects.toBeInstanceOf(IamOperatorOnlyError);
  });

  it('refuses to change your own operator status', async () => {
    await expect(manager.setOperator(operator, 'u-op', false)).rejects.toBeInstanceOf(IamSelfChangeError);
  });

  it('reports an unknown account', async () => {
    roles.findUser.mockResolvedValue(null);
    await expect(manager.setOperator(operator, 'u-x', true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes nothing when the status does not change', async () => {
    await manager.setOperator(operator, 'u-target', true);
    expect(tenancy.setOperator).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('makes an operator without counting', async () => {
    tenancy.isOperator.mockImplementation(async (userId: string) => userId === 'u-op');
    await manager.setOperator(operator, 'u-target', true);
    expect(tenancy.setOperator).toHaveBeenCalledWith('u-target', true, tx);
    expect(tenancy.countSignInOperators).not.toHaveBeenCalled();
  });

  describe('assertCanLeave', () => {
    it('refuses to let the last operator withdraw', async () => {
      tenancy.countSignInOperators.mockResolvedValue(0);
      await expect(manager.assertCanLeave('u-target')).rejects.toBeInstanceOf(IamLastOperatorError);
      expect(tenancy.lockOperators).toHaveBeenCalledWith(tx);
    });

    it('lets an operator withdraw while another remains', async () => {
      await expect(manager.assertCanLeave('u-target')).resolves.toBeUndefined();
    });

    it('lets someone who is not an operator withdraw without locking', async () => {
      await expect(manager.assertCanLeave('u-someone')).resolves.toBeUndefined();
      expect(tenancy.lockOperators).not.toHaveBeenCalled();
    });
  });

  describe('workingTenant', () => {
    const notOperator = { ...operator, userId: 'u-plain' };

    it("is the actor's own tenant when the request names none", async () => {
      await expect(manager.workingTenant(notOperator, undefined, tx as never)).resolves.toBe('1');
    });

    it('lets an operator work in a named tenant', async () => {
      tenancy.tenantExists.mockResolvedValue(true);
      await expect(manager.workingTenant(operator, 't2', tx as never)).resolves.toBe('t2');
    });

    it('refuses to let anyone else name a tenant', async () => {
      tenancy.tenantExists.mockResolvedValue(true);
      await expect(manager.workingTenant(notOperator, 't2', tx as never)).rejects.toBeInstanceOf(IamOperatorOnlyError);
    });

    it('reports a tenant that does not exist', async () => {
      tenancy.tenantExists.mockResolvedValue(false);
      await expect(manager.workingTenant(operator, 'nope', tx as never)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
