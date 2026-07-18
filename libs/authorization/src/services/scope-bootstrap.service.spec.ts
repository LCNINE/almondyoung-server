import { ScopeBootstrapService, type AuthorizationModuleOptions } from './scope-bootstrap.service';

describe('ScopeBootstrapService', () => {
  it('inserts scopes before reconciling ordered role mappings', async () => {
    const calls: string[] = [];
    const options: AuthorizationModuleOptions = {
      microserviceName: 'core',
      scopes: [{ key: 'fulfillment.warehouse.operate', category: 'fulfillment', description: 'operate' }],
      roleMappings: [
        { roleName: 'logistics_worker', scopeKeys: ['fulfillment.warehouse.operate'] },
        { roleName: 'logistics_manager', scopeKeys: ['fulfillment.warehouse.operate'] },
      ],
    };
    const authorizationService = {
      ensureScopesExist: jest.fn(async () => calls.push('scopes')),
      ensureRoleScopeMappings: jest.fn(async () => calls.push('mappings')),
    };

    await new ScopeBootstrapService(options, authorizationService as never).onModuleInit();

    expect(calls).toEqual(['scopes', 'mappings']);
    expect(authorizationService.ensureRoleScopeMappings).toHaveBeenCalledWith(options.roleMappings);
  });

  it('does not bootstrap mappings for existing services that did not declare them', async () => {
    const authorizationService = {
      ensureScopesExist: jest.fn().mockResolvedValue(undefined),
      ensureRoleScopeMappings: jest.fn(),
    };
    const options: AuthorizationModuleOptions = { microserviceName: 'legacy', scopes: [] };

    await new ScopeBootstrapService(options, authorizationService as never).onModuleInit();

    expect(authorizationService.ensureRoleScopeMappings).not.toHaveBeenCalled();
  });
});
