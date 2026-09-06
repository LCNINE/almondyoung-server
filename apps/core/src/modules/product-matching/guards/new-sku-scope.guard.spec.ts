import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NewSkuScopeGuard, bodyRequestsNewSku } from './new-sku-scope.guard';
import { ProductMatchingController } from '../controllers/product-matching.controller';
import { ProductSkuMappingController } from '../controllers/product-sku-mapping.controller';

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

    await expect(guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['admin']))).resolves.toBe(true);
    expect(authService.getScopesByRoles).toHaveBeenCalledWith(['admin']);
  });

  it('allows master without consulting the scope table', async () => {
    const authService = { getScopesByRoles: jest.fn() };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['master']))).resolves.toBe(
      true,
    );
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

    await expect(guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects when the scope lookup fails', async () => {
    const authService = { getScopesByRoles: jest.fn().mockRejectedValue(new Error('db down')) };
    const guard = new NewSkuScopeGuard(authService as never);

    await expect(
      guard.canActivate(makeContext({ links: [{ newSku: { name: 'x' } }] }, ['staff'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// 이 스위트가 없으면 위 9개 테스트는 가드의 *동작*만 지킬 뿐, 그 가드가 실제 라우트에
// 붙어 있는지는 아무도 검증하지 않는다 — `@UseGuards(NewSkuScopeGuard)` 줄을 지워도
// 위 테스트는 전부 초록으로 남는다. inventory-scope-coverage.spec.ts 는 modules/inventory 만
// 스캔하고, scope-guard-binding.spec.ts 는 @RequireScopes 쌍만 보므로 이 컨트롤러들은 그
// 안전망 밖이다. Reflect 로 핸들러 메타데이터를 직접 읽어 부착을 고정한다
// (관용구 출처: warehouse.controller.spec.ts, outbound-v2-authorization.spec.ts).
describe('NewSkuScopeGuard attachment (regression: @UseGuards line itself)', () => {
  function handlerFor(prototype: object, name: string): object {
    const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
    if (!handler) throw new Error(`${name} 핸들러가 없다 — 개명됐거나 삭제됐다`);
    return handler;
  }

  function guardsOn(handler: object): unknown[] {
    return (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
  }

  it('binds NewSkuScopeGuard to ProductMatchingController.resolveMatchingPending', () => {
    const handler = handlerFor(ProductMatchingController.prototype, 'resolveMatchingPending');
    expect(guardsOn(handler)).toContain(NewSkuScopeGuard);
  });

  it('binds NewSkuScopeGuard to ProductSkuMappingController.upsert', () => {
    const handler = handlerFor(ProductSkuMappingController.prototype, 'upsert');
    expect(guardsOn(handler)).toContain(NewSkuScopeGuard);
  });

  it('does not leak onto a neighboring ProductMatchingController handler', () => {
    const handler = handlerFor(ProductMatchingController.prototype, 'resolveLegacyIgnoredMatching');
    expect(guardsOn(handler)).not.toContain(NewSkuScopeGuard);
  });

  it('does not leak onto a neighboring ProductSkuMappingController handler', () => {
    const handler = handlerFor(ProductSkuMappingController.prototype, 'get');
    expect(guardsOn(handler)).not.toContain(NewSkuScopeGuard);
  });
});
