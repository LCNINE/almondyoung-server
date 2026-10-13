import { getPermissionDecision, isPermissionDecision, recordPermissionDecisions } from './permission-decision';

describe('permission decision stamp', () => {
  it('stamps only the given request', () => {
    const request = {};
    recordPermissionDecisions(request, ['fulfillment.dispatch.force']);
    expect(getPermissionDecision(request, 'fulfillment.dispatch.force')).toMatchObject({
      permission: 'fulfillment.dispatch.force',
      granted: true,
    });
    expect(getPermissionDecision(request, 'fulfillment.dispatch.station_force')).toBeUndefined();
    expect(getPermissionDecision({}, 'fulfillment.dispatch.force')).toBeUndefined();
  });

  it('accepts a stamp it issued for the same permission only', () => {
    const request = {};
    recordPermissionDecisions(request, ['fulfillment.dispatch.force']);
    const stamp = getPermissionDecision(request, 'fulfillment.dispatch.force');
    expect(isPermissionDecision(stamp, 'fulfillment.dispatch.force')).toBe(true);
    expect(isPermissionDecision(stamp, 'fulfillment.dispatch.station_force')).toBe(false);
  });

  it('rejects a look-alike decision object', () => {
    expect(
      isPermissionDecision({ permission: 'fulfillment.dispatch.force', granted: true }, 'fulfillment.dispatch.force'),
    ).toBe(false);
  });

  it('adds to earlier stamps on the same request', () => {
    const request = {};
    recordPermissionDecisions(request, ['a.b.read']);
    recordPermissionDecisions(request, ['a.b.write']);
    expect(getPermissionDecision(request, 'a.b.read')).toBeDefined();
    expect(getPermissionDecision(request, 'a.b.write')).toBeDefined();
  });

  it('ignores values that are not objects', () => {
    expect(getPermissionDecision(undefined, 'a.b.read')).toBeUndefined();
    expect(getPermissionDecision('request', 'a.b.read')).toBeUndefined();
  });
});
