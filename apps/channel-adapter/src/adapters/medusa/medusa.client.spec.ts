jest.mock('@medusajs/js-sdk', () => function Medusa() {});
jest.mock('./medusa-sdk.config', () => ({
  createMedusaSdk: jest.fn(),
}));

import { MedusaClient } from './medusa.client';

describe('MedusaClient.listOrders', () => {
  it('filters Payment Accepted orders client-side without unsupported payment_status query filters', async () => {
    const authorizedOrder = {
      id: 'order_authorized',
      payment_status: 'authorized',
      payment_collections: [{ payments: [{ id: 'pay_authorized', captures: [] }] }],
    };
    const capturedOrder = {
      id: 'order_captured',
      payment_status: 'captured',
      payment_collections: [{ payments: [{ id: 'pay_captured', captures: [{ id: 'cap_1' }] }] }],
    };
    const unpaidOrder = {
      id: 'order_unpaid',
      payment_status: 'not_paid',
      payment_collections: [{ payments: [] }],
    };
    const refundedOrderWithPayment = {
      id: 'order_refunded',
      payment_status: 'refunded',
      payment_collections: [{ payments: [{ id: 'pay_refunded', captures: [{ id: 'cap_refunded' }] }] }],
    };
    const fetch = jest
      .fn()
      .mockResolvedValue({ orders: [authorizedOrder, capturedOrder, unpaidOrder, refundedOrderWithPayment], count: 4 });
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = { client: { fetch } };

    const orders = await client.listOrders({ since: new Date('2026-05-26T00:00:00.000Z') });

    expect(orders).toEqual([authorizedOrder, capturedOrder]);

    expect(fetch).toHaveBeenCalledWith(
      '/admin/orders',
      expect.objectContaining({
        method: 'GET',
        query: expect.objectContaining({
          updated_at: { gt: '2026-05-26T00:00:00.000Z' },
        }),
      }),
    );
    const query = fetch.mock.calls[0][1].query;
    expect(query.fields).toContain('payment_status');
    expect(query.fields).toContain('payment_collections.payments.captures.id');
    expect(query).not.toHaveProperty('payment_status');
  });
});

describe('MedusaClient product sellable inventory projection', () => {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves existing manage_inventory when enriching existing variant ids', async () => {
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      variants: [
        {
          id: 'variant_medusa_1',
          sku: 'SKU-1',
          manage_inventory: true,
          metadata: { pimVariantId: 'pim-var-1' },
        },
      ],
    });

    const result = await (client as any).enrichPayloadWithExistingVariantIds('prod_1', {
      variants: [
        {
          title: 'Red',
          sku: 'SKU-1',
          manage_inventory: false,
          metadata: { pimVariantId: 'pim-var-1' },
        },
        {
          title: 'Blue',
          sku: 'SKU-2',
          manage_inventory: false,
          metadata: { pimVariantId: 'pim-var-2' },
        },
      ],
    });

    expect(result.variants[0]).toMatchObject({
      id: 'variant_medusa_1',
      manage_inventory: true,
    });
    expect(result.variants[1]).toMatchObject({
      sku: 'SKU-2',
      manage_inventory: false,
    });
    expect(result.variants[1]).not.toHaveProperty('id');
  });

  it('creates variant projection inventory items instead of reusing product SKU inventory identities', async () => {
    const batchVariantInventoryItems = jest.fn().mockResolvedValue({});
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).logger = logger;
    (client as any).sdk = {
      admin: {
        inventoryItem: {
          list: jest.fn().mockResolvedValue({ inventory_items: [] }),
          create: jest.fn().mockResolvedValue({ inventory_item: { id: 'iitem_projection' } }),
        },
        product: {
          retrieve: jest.fn().mockResolvedValue({
            product: {
              id: 'prod_1',
              variants: [
                {
                  id: 'variant_medusa_1',
                  title: 'Red',
                  sku: 'CORE-SKU-1',
                  metadata: { pimVariantId: 'pim-var-1' },
                  inventory_items: [
                    {
                      inventory_item_id: 'iitem_old_sku',
                      inventory: { sku: 'CORE-SKU-1', metadata: {} },
                    },
                  ],
                },
              ],
            },
          }),
          batchVariantInventoryItems,
        },
      },
    };

    await (client as any).ensureVariantInventoryLinks('prod_1', [
      {
        title: 'Red',
        sku: 'CORE-SKU-1',
        metadata: { pimVariantId: 'pim-var-1' },
      },
    ]);

    expect((client as any).sdk.admin.inventoryItem.list).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'psq_pim-var-1' }),
    );
    expect((client as any).sdk.admin.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'psq_pim-var-1',
        metadata: expect.objectContaining({
          projectionType: 'product_sellable_quantity',
          pimVariantId: 'pim-var-1',
        }),
      }),
    );
    expect(batchVariantInventoryItems).toHaveBeenCalledWith('prod_1', {
      create: [
        {
          inventory_item_id: 'iitem_projection',
          variant_id: 'variant_medusa_1',
          required_quantity: 1,
        },
      ],
      update: [],
      delete: [
        {
          inventory_item_id: 'iitem_old_sku',
          variant_id: 'variant_medusa_1',
        },
      ],
    });
  });

  it('turns off managed inventory for missing matching projection events', async () => {
    const batchVariants = jest.fn().mockResolvedValue({});
    const upsertProjectionInventoryLevel = jest.fn().mockResolvedValue(undefined);
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).logger = logger;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      id: 'prod_1',
      variants: [
        {
          id: 'variant_medusa_1',
          title: 'Red',
          sku: 'SKU-1',
          manage_inventory: true,
          metadata: { pimVariantId: 'pim-var-1' },
          inventory_items: [
            {
              inventory_item_id: 'iitem_projection',
              inventory: {
                sku: 'psq_pim-var-1',
                metadata: { projectionType: 'product_sellable_quantity', pimVariantId: 'pim-var-1' },
              },
            },
          ],
        },
      ],
    });
    (client as any).sdk = {
      admin: {
        product: { batchVariants },
      },
    };
    (client as any).upsertProjectionInventoryLevel = upsertProjectionInventoryLevel;

    await client.applyProductSellableQuantityProjection({
      medusaProductId: 'prod_1',
      variantId: 'pim-var-1',
      masterId: 'master-1',
      sellableQuantity: 0,
      isSellable: false,
      reason: 'MATCHING_MISSING',
      calculatedAt: '2026-05-27T00:00:00.000Z',
    });

    expect(batchVariants).toHaveBeenCalledWith('prod_1', {
      update: [{ id: 'variant_medusa_1', manage_inventory: false }],
    });
    expect(upsertProjectionInventoryLevel).toHaveBeenCalledWith('iitem_projection', 0);
  });

  it('turns on managed inventory and stores sellable quantity for stock-gated projection events', async () => {
    const batchVariants = jest.fn().mockResolvedValue({});
    const upsertProjectionInventoryLevel = jest.fn().mockResolvedValue(undefined);
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).logger = logger;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      id: 'prod_1',
      variants: [
        {
          id: 'variant_medusa_1',
          title: 'Red',
          sku: 'SKU-1',
          manage_inventory: false,
          metadata: { pimVariantId: 'pim-var-1' },
          inventory_items: [
            {
              inventory_item_id: 'iitem_projection',
              inventory: {
                sku: 'psq_pim-var-1',
                metadata: { projectionType: 'product_sellable_quantity', pimVariantId: 'pim-var-1' },
              },
            },
          ],
        },
      ],
    });
    (client as any).sdk = {
      admin: {
        product: { batchVariants },
      },
    };
    (client as any).upsertProjectionInventoryLevel = upsertProjectionInventoryLevel;

    await client.applyProductSellableQuantityProjection({
      medusaProductId: 'prod_1',
      variantId: 'pim-var-1',
      masterId: 'master-1',
      sellableQuantity: 7,
      isSellable: true,
      reason: 'SELLABLE',
      calculatedAt: '2026-05-27T00:00:00.000Z',
    });

    expect(batchVariants).toHaveBeenCalledWith('prod_1', {
      update: [{ id: 'variant_medusa_1', manage_inventory: true }],
    });
    expect(upsertProjectionInventoryLevel).toHaveBeenCalledWith('iitem_projection', 7);
  });

  it('throws when no Medusa variant has the matching pimVariantId', async () => {
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      id: 'prod_1',
      variants: [
        {
          id: 'variant_medusa_1',
          title: 'Red',
          sku: 'SKU-1',
          metadata: { pimVariantId: 'other-pim-var' },
        },
      ],
    });

    await expect(
      client.applyProductSellableQuantityProjection({
        medusaProductId: 'prod_1',
        variantId: 'pim-var-1',
        masterId: 'master-1',
        sellableQuantity: 7,
        isSellable: true,
        reason: 'SELLABLE',
        calculatedAt: '2026-05-27T00:00:00.000Z',
      }),
    ).rejects.toThrow('Medusa variant with pimVariantId=pim-var-1 not found on product prod_1');
  });

  it('links configured projection stock location to the default sales channel', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      stock_location: {
        id: 'sloc_configured',
        name: 'Projection Location',
        sales_channels: [],
      },
    });
    const updateSalesChannels = jest.fn().mockResolvedValue({});
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).configService = {
      get: jest.fn((key: string) =>
        key === 'MEDUSA_INVENTORY_PROJECTION_STOCK_LOCATION_ID' ? 'sloc_configured' : undefined,
      ),
    };
    (client as any).getDefaultSalesChannel = jest.fn().mockResolvedValue('sc_default');
    (client as any).sdk = {
      admin: {
        stockLocation: {
          retrieve,
          updateSalesChannels,
        },
      },
    };

    const stockLocationId = await (client as any).getProjectionStockLocationId();

    expect(stockLocationId).toBe('sloc_configured');
    expect(retrieve).toHaveBeenCalledWith('sloc_configured', {
      fields: 'id,name,*sales_channels',
    });
    expect(updateSalesChannels).toHaveBeenCalledWith('sloc_configured', {
      add: ['sc_default'],
    });
  });
});
