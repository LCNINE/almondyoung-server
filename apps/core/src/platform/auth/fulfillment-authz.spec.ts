import { AuthorizationService, isSystemPrincipal } from '@app/authorization';
import { legacyFulfillmentSupervisor, legacyHasFulfillmentScope, legacyHasShortPickScope } from './fulfillment-authz';
import { FULFILLMENT_SCOPE } from './fulfillment-scopes';
import { authzSubjectOf, FULFILLMENT_SYSTEM_ACTOR_ID } from './system-actor';

const authorization = (scopes: string[] | Error) => {
  const getScopesByRoles = jest.fn(async (): Promise<Set<string>> => {
    if (scopes instanceof Error) throw scopes;
    return new Set(scopes);
  });
  const fake: Pick<AuthorizationService, 'getScopesByRoles'> = { getScopesByRoles };
  return { fake, getScopesByRoles };
};

describe('fulfillment authz — legacy expressions kept in one place', () => {
  it('treats the fulfillment system actor as a system principal', () => {
    expect(isSystemPrincipal(authzSubjectOf({ id: FULFILLMENT_SYSTEM_ACTOR_ID, roles: ['master'] }))).toBe(true);
    expect(authzSubjectOf({ id: 'u-1', roles: ['master'] })).toEqual({ roles: ['master'] });
  });

  it('keeps the supervisor rule as it is today', () => {
    expect(legacyFulfillmentSupervisor(['logistics_manager'])).toBe(true);
    expect(legacyFulfillmentSupervisor(['master'])).toBe(true);
    expect(legacyFulfillmentSupervisor(['logistics_worker', 'admin'])).toBe(false);
  });

  it('lets master through without asking for scopes', async () => {
    const { fake, getScopesByRoles } = authorization([]);
    await expect(legacyHasFulfillmentScope(fake, ['master'], FULFILLMENT_SCOPE.DISPATCH_RECALL)).resolves.toBe(true);
    expect(getScopesByRoles).not.toHaveBeenCalled();
  });

  it('reads the mapped scope for other roles', async () => {
    const granted = authorization([FULFILLMENT_SCOPE.DISPATCH_RECALL]).fake;
    await expect(
      legacyHasFulfillmentScope(granted, ['logistics_manager'], FULFILLMENT_SCOPE.DISPATCH_RECALL),
    ).resolves.toBe(true);
    await expect(
      legacyHasFulfillmentScope(authorization([]).fake, ['logistics_worker'], FULFILLMENT_SCOPE.DISPATCH_RECALL),
    ).resolves.toBe(false);
  });

  it('keeps the legacy exception', async () => {
    await expect(
      legacyHasFulfillmentScope(authorization(new Error('db down')).fake, ['admin'], FULFILLMENT_SCOPE.SHIPMENT_REOPEN),
    ).rejects.toThrow('db down');
  });

  it('keeps the short pick rule including a mapped master scope', async () => {
    await expect(legacyHasShortPickScope(authorization(['master']).fake, ['logistics_worker'])).resolves.toBe(true);
    await expect(
      legacyHasShortPickScope(authorization([FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK]).fake, ['logistics_worker']),
    ).resolves.toBe(true);
    await expect(legacyHasShortPickScope(authorization([]).fake, ['admin'])).resolves.toBe(false);
  });
});
