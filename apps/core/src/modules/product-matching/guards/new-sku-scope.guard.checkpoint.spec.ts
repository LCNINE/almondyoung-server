import { AuthorizationService, checkpointEvaluations, createCheckpointsForTesting } from '@app/authorization';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { register } from 'prom-client';
import { NewSkuScopeGuard } from './new-sku-scope.guard';

class Probe {
  handle(): void {}
}

const contextFor = (roles: string[], body: unknown = { links: [{ newSku: {} }] }) => {
  const host = new ExecutionContextHost([{ body, user: { roles } }, {}], Probe, Probe.prototype.handle);
  host.setType('http');
  return host;
};

const auth = (result: Set<string> | Error): Pick<AuthorizationService, 'getScopesByRoles'> => ({
  getScopesByRoles: jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

describe('NewSkuScopeGuard permission comparison', () => {
  beforeEach(() => {
    register.resetMetrics();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('compares the new SKU permission when the body asks for a new SKU', async () => {
    const guard = new NewSkuScopeGuard(
      auth(new Set(['inventory.manage'])),
      createCheckpointsForTesting({ admin: ['inventory.master.write'] }),
    );
    await expect(guard.canActivate(contextFor(['admin']))).resolves.toBe(true);
    expect(await checkpointEvaluations('inventory.new_sku', 'match')).toBe(1);
  });

  it('keeps the legacy denial when the scope lookup fails and records nothing', async () => {
    const guard = new NewSkuScopeGuard(
      auth(new Error('db down')),
      createCheckpointsForTesting({ admin: ['inventory.master.write'] }),
    );
    await expect(guard.canActivate(contextFor(['admin']))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await checkpointEvaluations('inventory.new_sku', 'match')).toBe(0);
    expect(await checkpointEvaluations('inventory.new_sku', 'would_allow')).toBe(0);
  });

  it('does not compare anything when the body does not create a SKU', async () => {
    const guard = new NewSkuScopeGuard(auth(new Set()), createCheckpointsForTesting({}));
    await expect(guard.canActivate(contextFor(['logistics_worker'], { links: [] }))).resolves.toBe(true);
    expect(await checkpointEvaluations('inventory.new_sku', 'match')).toBe(0);
  });

  it('lets the permission decide when the legacy lookup fails once enforced', async () => {
    const guard = new NewSkuScopeGuard(
      auth(new Error('db down')),
      createCheckpointsForTesting({ admin: ['inventory.master.write'] }, { enforce: true }),
    );
    await expect(guard.canActivate(contextFor(['admin']))).resolves.toBe(true);
  });

  it('denies a new SKU without inventory.master.write once enforced', async () => {
    const guard = new NewSkuScopeGuard(
      auth(new Set(['inventory.manage'])),
      createCheckpointsForTesting({ admin: [] }, { enforce: true }),
    );
    await expect(guard.canActivate(contextFor(['admin']))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still denies on a lookup failure while off', async () => {
    const guard = new NewSkuScopeGuard(
      auth(new Error('db down')),
      createCheckpointsForTesting({ admin: ['inventory.master.write'] }, { enforce: false }),
    );
    await expect(guard.canActivate(contextFor(['admin']))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

