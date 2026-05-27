import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { getInventoryValidationFailures, validateInventoryForItems } from '../validate-inventory';

type VariantInput = {
  id: string;
  title?: string;
  manage_inventory?: boolean;
  allow_backorder?: boolean;
};

const makeContainer = ({
  variants,
  variantInventoryData,
  levelsByInventoryItemId,
}: {
  variants: VariantInput[];
  variantInventoryData: any[];
  levelsByInventoryItemId: Record<string, Array<{ stocked_quantity?: number; reserved_quantity?: number }>>;
}) => {
  const inventoryService = {
    listInventoryLevels: jest.fn(async ({ inventory_item_id }: { inventory_item_id: string }) => {
      return levelsByInventoryItemId[inventory_item_id] ?? [];
    }),
  };

  const productService = {
    listProductVariants: jest.fn(async () => variants),
  };

  const query = {
    graph: jest.fn(async () => ({ data: variantInventoryData })),
  };

  const container = {
    resolve: jest.fn((key: string) => {
      if (key === Modules.INVENTORY) return inventoryService;
      if (key === Modules.PRODUCT) return productService;
      if (key === ContainerRegistrationKeys.QUERY) return query;
      throw new Error(`Unexpected dependency resolved: ${key}`);
    }),
  };

  return { container, inventoryService, productService, query };
};

describe('validateInventoryForItems', () => {
  it('blocks stock-gated variants using Medusa local projection inventory levels', async () => {
    const { container } = makeContainer({
      variants: [{ id: 'variant_1', title: 'Managed Variant', manage_inventory: true }],
      variantInventoryData: [
        {
          id: 'variant_1',
          inventory_items: [
            {
              inventory_item_id: 'iitem_projection_1',
              inventory: {
                sku: 'psq_pim_variant_1',
                metadata: { projectionType: 'product_sellable_quantity', projectionSource: 'core' },
              },
            },
          ],
        },
      ],
      levelsByInventoryItemId: {
        iitem_projection_1: [{ stocked_quantity: 2, reserved_quantity: 0 }],
      },
    });

    await expect(
      validateInventoryForItems(
        {
          items: [{ variant_id: 'variant_1', quantity: 3 }],
          variants: [{ id: 'variant_1', product: { title: 'Projection Product' } }],
        },
        container,
      ),
    ).rejects.toThrow('최대 2개까지 구매 가능합니다');
  });

  it('uses the product sellable quantity projection item before stale legacy inventory links', async () => {
    const { container, inventoryService } = makeContainer({
      variants: [{ id: 'variant_1', title: 'Managed Variant', manage_inventory: true }],
      variantInventoryData: [
        {
          id: 'variant_1',
          inventory_items: [
            {
              inventory_item_id: 'iitem_legacy_sku',
              inventory: {
                sku: 'core_sku_legacy',
                metadata: {},
              },
            },
            {
              inventory_item_id: 'iitem_projection_1',
              inventory: {
                sku: 'psq_pim_variant_1',
                metadata: { projectionType: 'product_sellable_quantity' },
              },
            },
          ],
        },
      ],
      levelsByInventoryItemId: {
        iitem_legacy_sku: [{ stocked_quantity: 99, reserved_quantity: 0 }],
        iitem_projection_1: [{ stocked_quantity: 0, reserved_quantity: 0 }],
      },
    });

    await expect(
      validateInventoryForItems(
        {
          items: [{ variant_id: 'variant_1', quantity: 1 }],
          variants: [{ id: 'variant_1', product: { title: 'Projection Product' } }],
        },
        container,
      ),
    ).rejects.toThrow('품절된 상품입니다');

    expect(inventoryService.listInventoryLevels).toHaveBeenCalledWith({
      inventory_item_id: 'iitem_projection_1',
    });
  });

  it('returns projection-aware failures for cart completion payloads', async () => {
    const { container, inventoryService } = makeContainer({
      variants: [{ id: 'variant_1', title: 'Managed Variant', manage_inventory: true }],
      variantInventoryData: [
        {
          id: 'variant_1',
          inventory_items: [
            {
              inventory_item_id: 'iitem_legacy_sku',
              inventory: {
                sku: 'core_sku_legacy',
                metadata: {},
              },
            },
            {
              inventory_item_id: 'iitem_projection_1',
              inventory: {
                sku: 'psq_pim_variant_1',
                metadata: { projectionSource: 'core' },
              },
            },
          ],
        },
      ],
      levelsByInventoryItemId: {
        iitem_legacy_sku: [{ stocked_quantity: 0, reserved_quantity: 0 }],
        iitem_projection_1: [{ stocked_quantity: 3, reserved_quantity: 0 }],
      },
    });

    await expect(
      getInventoryValidationFailures(
        {
          items: [{ variant_id: 'variant_1', quantity: 2 }],
          variants: [{ id: 'variant_1', product: { title: 'Projection Product' } }],
        },
        container,
      ),
    ).resolves.toEqual([]);

    expect(inventoryService.listInventoryLevels).toHaveBeenCalledWith({
      inventory_item_id: 'iitem_projection_1',
    });
  });

  it('allows quantities covered by local stocked minus reserved quantity', async () => {
    const { container } = makeContainer({
      variants: [{ id: 'variant_1', title: 'Managed Variant', manage_inventory: true }],
      variantInventoryData: [
        {
          id: 'variant_1',
          inventory_items: [
            {
              inventory_item_id: 'iitem_projection_1',
              inventory: {
                sku: 'psq_pim_variant_1',
                metadata: { projectionSource: 'core' },
              },
            },
          ],
        },
      ],
      levelsByInventoryItemId: {
        iitem_projection_1: [{ stocked_quantity: 5, reserved_quantity: 1 }],
      },
    });

    await expect(
      validateInventoryForItems(
        {
          items: [{ variant_id: 'variant_1', quantity: 4 }],
          variants: [{ id: 'variant_1', product: { title: 'Projection Product' } }],
        },
        container,
      ),
    ).resolves.toBeUndefined();
  });

  it('skips unmanaged variants without resolving inventory levels', async () => {
    const { container, inventoryService } = makeContainer({
      variants: [{ id: 'variant_1', title: 'Unmanaged Variant', manage_inventory: false }],
      variantInventoryData: [{ id: 'variant_1', inventory_items: [] }],
      levelsByInventoryItemId: {},
    });

    await expect(
      validateInventoryForItems(
        {
          items: [{ variant_id: 'variant_1', quantity: 100 }],
          variants: [{ id: 'variant_1', product: { title: 'Unmanaged Product' } }],
        },
        container,
      ),
    ).resolves.toBeUndefined();

    expect(inventoryService.listInventoryLevels).not.toHaveBeenCalled();
  });
});
