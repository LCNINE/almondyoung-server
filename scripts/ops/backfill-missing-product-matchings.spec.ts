import { backfillApplyMode, backfillPartition, MissingVariant } from './backfill-missing-product-matchings';
import { calculateProductSellableQuantity } from '../../apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator';
import { shouldManageMedusaInventoryForSellableProjection } from '../../packages/domain-types/medusa-inventory-projection';

const active: MissingVariant = {
  variant_id: 'variant',
  creation_week: '2026-10-19',
  variant_status: 'active',
  version_statuses: ['active', 'draft', 'inactive'],
  master_ids: ['master'],
  active_master_ids: ['master'],
  has_live_master: true,
  has_live_version: true,
  waiting_orders: 1,
};

it('selects an active variant once even when shared with draft or historical versions', () => {
  expect(backfillPartition(active)).toBe('eligible');
});

it.each<[Partial<MissingVariant>, string]>([
  [{ master_ids: ['master', 'other'] }, 'ambiguous_master'],
  [{ has_live_master: false, has_live_version: false, active_master_ids: [] }, 'deleted_master'],
  [{ has_live_version: false, active_master_ids: [] }, 'deleted_versions'],
  [{ version_statuses: ['draft'], active_master_ids: [] }, 'no_active_version'],
  [{ version_statuses: ['inactive'], active_master_ids: [] }, 'no_active_version'],
  [{ variant_status: 'inactive' }, 'variant_inactive'],
])('reports excluded variants separately: %j', (patch, partition) => {
  expect(backfillPartition({ ...active, ...patch })).toBe(partition);
});

it('defaults to dry-run and requires an unambiguous explicit apply flag', () => {
  expect(backfillApplyMode([], undefined)).toBe(false);
  expect(backfillApplyMode([], '1')).toBe(false);
  expect(backfillApplyMode(['--apply'], undefined)).toBe(true);
  expect(backfillApplyMode(['--apply'], '0')).toBe(true);
  expect(() => backfillApplyMode([], '0')).toThrow('requires --apply');
  expect(() => backfillApplyMode(['--apply'], '1')).toThrow('Remove DRY_RUN=1');
  expect(() => backfillApplyMode(['--aply'], undefined)).toThrow('Only --apply');
  expect(() => backfillApplyMode([], 'false')).toThrow('DRY_RUN must be');
});

it.each([null, 'manual_out_of_stock', 'coming_soon'] as const)(
  'missing to pending preserves purchase gating with override %s',
  (availabilityOverride) => {
    const input = {
      variantId: 'variant',
      variantStatus: 'active',
      activeVersion: { masterId: 'master', versionId: 'version' },
      components: [],
      availabilityOverride,
    };
    const missing = calculateProductSellableQuantity({ ...input, matching: null });
    const pending = calculateProductSellableQuantity({
      ...input,
      matching: {
        id: 'matching',
        status: 'pending',
        strategy: null,
        preStockSellable: true,
        alwaysSellableZeroStock: false,
      },
    });

    expect(pending.sellableQuantity).toBe(missing.sellableQuantity);
    expect(pending.isSellable).toBe(missing.isSellable);
    expect(shouldManageMedusaInventoryForSellableProjection(pending)).toBe(
      shouldManageMedusaInventoryForSellableProjection(missing),
    );
  },
);
