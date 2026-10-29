import { ProductModel3dProjection } from '../../../catalog/core/products/services/product-model3d-projection';

/** Mapping tests without catalog fixtures have no active product model to refresh. */
export function createModel3dProjectionStub(): ProductModel3dProjection {
  return {
    lockSkus: async () => undefined,
    lockVariantTargets: async () => [],
    capture: async () => new Map(),
    refresh: async () => undefined,
  } as unknown as ProductModel3dProjection;
}
