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

  // notification 처럼 인증/역할 가드만 쓰는 서비스는 자기 DB 에 `auth` 스키마가 없다.
  // 등록할 게 없는데도 SELECT 를 날리면 그런 서비스는 부팅에서 죽는다.
  it('선언된 스코프도 매핑도 없으면 DB 를 전혀 건드리지 않는다', async () => {
    const authorizationService = {
      ensureScopesExist: jest.fn(),
      ensureRoleScopeMappings: jest.fn(),
    };
    const options: AuthorizationModuleOptions = { microserviceName: 'notification', scopes: [], roleMappings: [] };

    await new ScopeBootstrapService(options, authorizationService as never).onModuleInit();

    expect(authorizationService.ensureScopesExist).not.toHaveBeenCalled();
    expect(authorizationService.ensureRoleScopeMappings).not.toHaveBeenCalled();
  });

  it('스코프가 하나라도 있으면 여전히 부트스트랩한다', async () => {
    const authorizationService = {
      ensureScopesExist: jest.fn().mockResolvedValue(undefined),
      ensureRoleScopeMappings: jest.fn(),
    };
    const options: AuthorizationModuleOptions = {
      microserviceName: 'ugc-service',
      scopes: [{ key: 'admin:ugc:read', category: 'admin', description: 'read' }],
    };

    await new ScopeBootstrapService(options, authorizationService as never).onModuleInit();

    expect(authorizationService.ensureScopesExist).toHaveBeenCalledTimes(1);
  });
});
