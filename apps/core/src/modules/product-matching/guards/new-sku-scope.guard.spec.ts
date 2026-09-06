import { ForbiddenException } from '@nestjs/common';
import { NewSkuScopeGuard, bodyRequestsNewSku } from './new-sku-scope.guard';

function makeContext(body: unknown, roles?: string[]) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ body, user: roles ? { roles } : undefined }) }),
  } as never;
}

describe('bodyRequestsNewSku', () => {
  it('is false for a body without links', () => {
    expect(bodyRequestsNewSku({ skuMappings: [{ skuId: 'x' }] })).toBe(false);
    expect(bodyRequestsNewSku(undefined)).toBe(false);
    expect(bodyRequestsNewSku('links')).toBe(false);
  });

  it('is false when every link references an existing SKU', () => {
    expect(bodyRequestsNewSku({ links: [{ skuId: 'a' }, { skuId: 'b' }] })).toBe(false);
  });

  it('is true when any link carries newSku', () => {
    expect(bodyRequestsNewSku({ links: [{ skuId: 'a' }, { newSku: { name: 'x' } }] })).toBe(true);
  });
});

describe('NewSkuScopeGuard', () => {
  it('lets a request without newSku through untouched', async () => {
    const authService = { getScopesByRoles: jest.fn() };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(guard.canActivate(makeContext({ links: [{ skuId: 'a' }] }, ['admin']))).resolves.toBe(true);
    expect(authService.getScopesByRoles).not.toHaveBeenCalled();
  });

  it('allows newSku when the role set grants inventory.manage', async () => {
    const authService = { getScopesByRoles: jest.fn().mockResolvedValue(new Set(['inventory.manage'])) };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['admin'])),
    ).resolves.toBe(true);
    expect(authService.getScopesByRoles).toHaveBeenCalledWith(['admin']);
  });

  it('allows master without consulting the scope table', async () => {
    const authService = { getScopesByRoles: jest.fn() };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['master'])),
    ).resolves.toBe(true);
    expect(authService.getScopesByRoles).not.toHaveBeenCalled();
  });

  it('rejects newSku when the role set lacks inventory.manage', async () => {
    const authService = { getScopesByRoles: jest.fn().mockResolvedValue(new Set(['inventory.operate'])) };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['staff'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects newSku when the request carries no roles', async () => {
    const authService = { getScopesByRoles: jest.fn() };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the scope lookup fails', async () => {
    const authService = { getScopesByRoles: jest.fn().mockRejectedValue(new Error('db down')) };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['staff'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
