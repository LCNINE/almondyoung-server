import { createCheckpointsForTesting, isSystemPrincipal } from '@app/authorization';
import { authzSubjectOf, FULFILLMENT_SYSTEM_ACTOR, FULFILLMENT_SYSTEM_ACTOR_ID } from './system-actor';

describe('fulfillment system actor', () => {
  it('treats the explicit system actor as a system principal', () => {
    expect(isSystemPrincipal(authzSubjectOf(FULFILLMENT_SYSTEM_ACTOR))).toBe(true);
  });

  it('carries no role name', () => {
    expect(FULFILLMENT_SYSTEM_ACTOR.roles).toEqual([]);
  });

  it('does not trust the fixed id on a person actor', () => {
    const person = { id: FULFILLMENT_SYSTEM_ACTOR_ID, roles: [] };
    expect(authzSubjectOf(person)).toEqual({ roles: [] });
    expect(
      createCheckpointsForTesting().check('fulfillment.planning_scope', authzSubjectOf(person), [
        'fulfillment.shipment.reopen',
      ]),
    ).toBe(false);
  });

  it('lets the system actor through a checkpoint even before the permission copy arrives', () => {
    expect(
      createCheckpointsForTesting(null).check('fulfillment.planning_scope', authzSubjectOf(FULFILLMENT_SYSTEM_ACTOR), [
        'fulfillment.shipment.reopen',
      ]),
    ).toBe(true);
  });

  it('judges a person actor by roles', () => {
    expect(authzSubjectOf({ id: 'u1', roles: ['admin'] })).toEqual({ roles: ['admin'] });
  });
});
