import { createCheckpointsForTesting } from '@app/authorization';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { NewSkuPermissionGuard, bodyRequestsNewSku } from './new-sku-permission.guard';
import { ProductMatchingController } from '../controllers/product-matching.controller';
import { ProductSkuMappingController } from '../controllers/product-sku-mapping.controller';

const NEW_SKU_DENIED = '새 재고상품을 만들려면 inventory.master.write 권한이 필요합니다.';
const NEW_SKU_BODY = { links: [{ skuId: 'a' }, { newSku: { name: 'x' } }] };

class Probe {
  handle(): void {}
}

function contextFor(body: unknown, user?: { roles?: unknown }) {
  const host = new ExecutionContextHost([{ body, user }, {}], Probe, Probe.prototype.handle);
  host.setType('http');
  return host;
}

const MATCHING_ROLES = {
  matcher: ['order.matching.write'],
  matcher2: ['order.matching.write', 'inventory.master.write'],
};

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
    expect(bodyRequestsNewSku(NEW_SKU_BODY)).toBe(true);
  });
});

describe('NewSkuPermissionGuard', () => {
  it('rejects a new SKU for a role that can only match orders', () => {
    const guard = new NewSkuPermissionGuard(createCheckpointsForTesting(MATCHING_ROLES));
    const attempt = () => guard.canActivate(contextFor(NEW_SKU_BODY, { roles: ['matcher'] }));

    expect(attempt).toThrow(ForbiddenException);
    expect(attempt).toThrow(NEW_SKU_DENIED);
  });

  it('allows a new SKU when the role also holds inventory.master.write', () => {
    const guard = new NewSkuPermissionGuard(createCheckpointsForTesting(MATCHING_ROLES));

    expect(guard.canActivate(contextFor(NEW_SKU_BODY, { roles: ['matcher2'] }))).toBe(true);
  });

  it('lets a request without newSku through even before the permission copy arrives', () => {
    const guard = new NewSkuPermissionGuard(createCheckpointsForTesting(null));

    expect(guard.canActivate(contextFor({ links: [{ skuId: 'a' }] }, { roles: ['matcher'] }))).toBe(true);
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('rejects a new SKU while the permission copy has not arrived', () => {
    const guard = new NewSkuPermissionGuard(createCheckpointsForTesting(null));

    expect(() => guard.canActivate(contextFor(NEW_SKU_BODY, { roles: ['matcher2'] }))).toThrow(NEW_SKU_DENIED);
  });

  it('follows the default role grants: admin may create a SKU, a logistics worker may not', () => {
    const guard = new NewSkuPermissionGuard(createCheckpointsForTesting());

    expect(guard.canActivate(contextFor(NEW_SKU_BODY, { roles: ['admin'] }))).toBe(true);
    expect(() => guard.canActivate(contextFor(NEW_SKU_BODY, { roles: ['logistics_worker'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('treats a missing or non-array role claim as no roles', () => {
    const guard = new NewSkuPermissionGuard(createCheckpointsForTesting());

    expect(() => guard.canActivate(contextFor(NEW_SKU_BODY))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor(NEW_SKU_BODY, { roles: 'admin' }))).toThrow(ForbiddenException);
  });
});

describe('NewSkuPermissionGuard attachment', () => {
  function handlerFor(prototype: object, name: string): object {
    const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
    if (!handler) throw new Error(`${name} 핸들러가 없다 — 개명됐거나 삭제됐다`);
    return handler;
  }

  function guardsOn(handler: object): unknown[] {
    const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
    return Array.isArray(guards) ? guards : [];
  }

  it('binds NewSkuPermissionGuard to ProductMatchingController.resolveMatchingPending', () => {
    const handler = handlerFor(ProductMatchingController.prototype, 'resolveMatchingPending');
    expect(guardsOn(handler)).toContain(NewSkuPermissionGuard);
  });

  it('binds NewSkuPermissionGuard to ProductSkuMappingController.upsert', () => {
    const handler = handlerFor(ProductSkuMappingController.prototype, 'upsert');
    expect(guardsOn(handler)).toContain(NewSkuPermissionGuard);
  });

  it('does not leak onto a neighboring ProductMatchingController handler', () => {
    const handler = handlerFor(ProductMatchingController.prototype, 'resolveLegacyIgnoredMatching');
    expect(guardsOn(handler)).not.toContain(NewSkuPermissionGuard);
  });

  it('does not leak onto a neighboring ProductSkuMappingController handler', () => {
    const handler = handlerFor(ProductSkuMappingController.prototype, 'get');
    expect(guardsOn(handler)).not.toContain(NewSkuPermissionGuard);
  });
});
