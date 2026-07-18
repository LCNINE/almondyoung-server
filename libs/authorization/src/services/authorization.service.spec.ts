import { AuthorizationService } from './authorization.service';
import type { AuthorizationModuleOptions } from './scope-bootstrap.service';

describe('AuthorizationService role mappings', () => {
  const options: AuthorizationModuleOptions = {
    microserviceName: 'core',
    scopes: [],
    roleMappings: [
      { roleName: 'logistics_worker', scopeKeys: ['fulfillment.warehouse.operate'] },
      {
        roleName: 'logistics_manager',
        scopeKeys: ['fulfillment.warehouse.operate', 'fulfillment.dispatch.force'],
      },
    ],
  };

  it('fails closed for an unknown configured-service role without querying stale mappings', async () => {
    const db = { select: jest.fn() };
    const service = new AuthorizationService({ db } as never, options);

    await expect(service.getScopesByRoles(['unknown_role'])).resolves.toEqual(new Set());
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns an empty set when a known role has no persisted mapping', async () => {
    const where = jest.fn().mockResolvedValue([]);
    const innerJoin = jest.fn(() => ({ where }));
    const from = jest.fn(() => ({ innerJoin }));
    const db = { select: jest.fn(() => ({ from })) };
    const service = new AuthorizationService({ db } as never, options);

    await expect(service.getScopesByRoles(['logistics_worker'])).resolves.toEqual(new Set());
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('filters stale extra and master mappings before caching configured role scopes', async () => {
    const where = jest
      .fn()
      .mockResolvedValue([
        { scopeKey: 'fulfillment.warehouse.operate' },
        { scopeKey: 'fulfillment.dispatch.force' },
        { scopeKey: 'master' },
      ]);
    const innerJoin = jest.fn(() => ({ where }));
    const from = jest.fn(() => ({ innerJoin }));
    const db = { select: jest.fn(() => ({ from })) };
    const service = new AuthorizationService({ db } as never, options);

    await expect(service.getScopesByRoles(['logistics_worker'])).resolves.toEqual(
      new Set(['fulfillment.warehouse.operate']),
    );
    await expect(service.getScopesByRoles(['logistics_worker'])).resolves.toEqual(
      new Set(['fulfillment.warehouse.operate']),
    );
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('rejects missing scope definitions before modifying role mappings', async () => {
    const where = jest.fn().mockResolvedValue([{ id: 'scope-operate', key: 'fulfillment.warehouse.operate' }]);
    const from = jest.fn(() => ({ where }));
    const transaction = jest.fn();
    const db = { select: jest.fn(() => ({ from })), transaction };
    const service = new AuthorizationService({ db } as never, options);

    await expect(service.ensureRoleScopeMappings(options.roleMappings!)).rejects.toThrow(
      'Scopes not found for role mappings: fulfillment.dispatch.force',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('reconciles each configured role to the exact desired set in one transaction', async () => {
    const scopeRows = [
      { id: 'scope-operate', key: 'fulfillment.warehouse.operate' },
      { id: 'scope-force', key: 'fulfillment.dispatch.force' },
    ];
    const selectWhere = jest.fn().mockResolvedValue(scopeRows);
    const selectFrom = jest.fn(() => ({ where: selectWhere }));
    const deleteWhere = jest.fn().mockResolvedValue(undefined);
    const deleteFrom = jest.fn(() => ({ where: deleteWhere }));
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const insertValues = jest.fn(() => ({ onConflictDoNothing }));
    const insertInto = jest.fn(() => ({ values: insertValues }));
    const tx = { delete: deleteFrom, insert: insertInto };
    const transaction = jest.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx));
    const db = { select: jest.fn(() => ({ from: selectFrom })), transaction };
    const service = new AuthorizationService({ db } as never, options);

    await service.ensureRoleScopeMappings(options.roleMappings!);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenNthCalledWith(1, [{ roleName: 'logistics_worker', scopeId: 'scope-operate' }]);
    expect(insertValues).toHaveBeenNthCalledWith(2, [
      { roleName: 'logistics_manager', scopeId: 'scope-operate' },
      { roleName: 'logistics_manager', scopeId: 'scope-force' },
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});
