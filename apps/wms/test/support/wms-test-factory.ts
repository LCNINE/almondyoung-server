import { WmsTestDatabase } from './wms-test-database';
import { wmsTables } from '../../database/schemas/wms-schema';
import { faker } from '@faker-js/faker';

export class WmsTestFactory {
  private static get db() {
    return WmsTestDatabase.getDb();
  }

  // Warehouse Factory
  static async createWarehouse(overrides: Partial<any> = {}) {
    const warehouse = {
      name: faker.company.name() + ' Warehouse',
      location: faker.location.streetAddress(),
      type: 'domestic' as const,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.warehouses)
      .values(warehouse)
      .returning();

    return created;
  }

  // SKU Factory
  static async createSku(overrides: Partial<any> = {}) {
    const sku = {
      name: faker.commerce.productName(),
      code: `SKU-${faker.string.alphanumeric(8)}`,
      holderId: '00000000-0000-0000-0000-000000000000', // Default holder
      stockType: 'physical' as const,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.skus)
      .values(sku)
      .returning();

    return created;
  }

  // Holder Factory
  static async createHolder(overrides: Partial<any> = {}) {
    const holder = {
      name: faker.company.name(),
      isOurAsset: true,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.holders)
      .values(holder)
      .returning();

    return created;
  }

  // Supplier Factory
  static async createSupplier(overrides: Partial<any> = {}) {
    const supplier = {
      name: faker.company.name(),
      contactInfo: {
        email: faker.internet.email(),
        phone: faker.phone.number(),
        address: faker.location.streetAddress()
      },
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.suppliers)
      .values(supplier)
      .returning();

    return created;
  }

  // Stock Factory
  static async createStock(overrides: Partial<any> = {}) {
    // Create dependencies if not provided
    let warehouseId = overrides.warehouseId;
    let skuId = overrides.skuId;

    if (!warehouseId) {
      const warehouse = await this.createWarehouse();
      warehouseId = warehouse.id;
    }

    if (!skuId) {
      const sku = await this.createSku();
      skuId = sku.id;
    }

    const stock = {
      warehouseId,
      skuId,
      currentQuantity: faker.number.int({ min: 10, max: 100 }),
      availableQuantity: faker.number.int({ min: 5, max: 50 }),
      reservedQuantity: 0,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.stockSummary)
      .values(stock)
      .returning();

    return created;
  }

  // Sales Order Factory
  static async createSalesOrder(overrides: Partial<any> = {}) {
    const salesOrder = {
      channelOrderId: `SO-${faker.string.alphanumeric(8)}`,
      salesChannel: 'medusa' as const,
      customerName: faker.person.fullName(),
      customerEmail: faker.internet.email(),
      status: 'pending' as const,
      shippingAddress: {
        name: faker.person.fullName(),
        phone: faker.phone.number(),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        postalCode: faker.location.zipCode()
      },
      orderDate: new Date(),
      totalAmount: faker.number.int({ min: 10000, max: 100000 }),
      currency: 'KRW',
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.salesOrders)
      .values(salesOrder)
      .returning();

    return created;
  }

  // Sales Order Line Factory
  static async createSalesOrderLine(overrides: Partial<any> = {}) {
    let salesOrderId = overrides.salesOrderId;
    let variantId = overrides.variantId;

    if (!salesOrderId) {
      const salesOrder = await this.createSalesOrder();
      salesOrderId = salesOrder.id;
    }

    if (!variantId) {
      variantId = faker.string.uuid();
    }

    const line = {
      salesOrderId,
      variantId,
      productName: faker.commerce.productName(),
      quantity: faker.number.int({ min: 1, max: 10 }),
      unitPrice: faker.number.int({ min: 1000, max: 50000 }),
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.salesOrderLines)
      .values(line)
      .returning();

    return created;
  }

  // Fulfillment Order Factory
  static async createFulfillmentOrder(overrides: Partial<any> = {}) {
    let warehouseId = overrides.warehouseId;

    if (!warehouseId) {
      const warehouse = await this.createWarehouse();
      warehouseId = warehouse.id;
    }

    const fulfillmentOrder = {
      warehouseId,
      status: 'created' as const,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.fulfillmentOrders)
      .values(fulfillmentOrder)
      .returning();

    return created;
  }

  // Fulfillment Order Item Factory
  static async createFulfillmentOrderItem(overrides: Partial<any> = {}) {
    let fulfillmentOrderId = overrides.fulfillmentOrderId;
    let skuId = overrides.skuId;
    let mappingSnapshotId = overrides.mappingSnapshotId;

    if (!fulfillmentOrderId) {
      const fo = await this.createFulfillmentOrder();
      fulfillmentOrderId = fo.id;
    }

    if (!skuId) {
      const sku = await this.createSku();
      skuId = sku.id;
    }

    if (!mappingSnapshotId) {
      // Create a minimal mapping snapshot for testing - need warehouse
      const warehouse = await this.createWarehouse();
      const [snapshot] = await this.db.insert(wmsTables.productSkuMappingSnapshots)
        .values({
          productId: `product-${faker.string.alphanumeric(8)}`,
          sourceVersion: 1,
          warehouseId: warehouse.id,
          snapshotData: {
            items: [{ skuId, qtyPerProduct: 1 }]
          }
        })
        .returning();
      mappingSnapshotId = snapshot.id;
    }

    const item = {
      fulfillmentOrderId,
      salesOrderId: `SO-${faker.string.alphanumeric(8)}`,
      salesOrderLineId: `SOL-${faker.string.alphanumeric(8)}`,
      mappingSnapshotId,
      skuId,
      qty: faker.number.int({ min: 1, max: 10 }),
      reservedQty: 0,
      pickedQty: 0,
      shippedQty: 0,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.fulfillmentOrderItems)
      .values(item)
      .returning();

    return created;
  }

  // Outbound Batch Factory
  static async createOutboundBatch(overrides: Partial<any> = {}) {
    let warehouseId = overrides.warehouseId;

    if (!warehouseId) {
      const warehouse = await this.createWarehouse();
      warehouseId = warehouse.id;
    }

    const batch = {
      batchNumber: `BATCH-${faker.string.alphanumeric(6)}`,
      warehouseId,
      pickingMethod: 'individual' as const,
      status: 'created' as const,
      totalItems: 0,
      totalQty: 0,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.outboundBatches)
      .values(batch)
      .returning();

    return created;
  }

  // Stock Reservation Factory
  static async createStockReservation(overrides: Partial<any> = {}) {
    let skuId = overrides.skuId;
    let fulfillmentOrderItemId = overrides.fulfillmentOrderItemId;

    if (!skuId) {
      const sku = await this.createSku();
      skuId = sku.id;
    }

    if (!fulfillmentOrderItemId) {
      const foi = await this.createFulfillmentOrderItem({ skuId });
      fulfillmentOrderItemId = foi.id;
    }

    const reservation = {
      skuId,
      fulfillmentOrderItemId,
      quantity: faker.number.int({ min: 1, max: 10 }),
      status: 'pending' as const,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.stockReservations)
      .values(reservation)
      .returning();

    return created;
  }

  // Complex scenario factories
  static async createCompleteOrderFlow(overrides: Partial<any> = {}) {
    // Create warehouse and SKU
    const warehouse = await this.createWarehouse();
    const sku = await this.createSku();
    const stock = await this.createStock({
      warehouseId: warehouse.id,
      skuId: sku.id,
      currentQuantity: 100,
      availableQuantity: 100
    });

    // Create sales order
    const salesOrder = await this.createSalesOrder();
    const salesOrderLine = await this.createSalesOrderLine({
      salesOrderId: salesOrder.id,
      skuId: sku.id
    });

    // Create fulfillment order
    const fulfillmentOrder = await this.createFulfillmentOrder({
      warehouseId: warehouse.id,
      ...overrides
    });

    // Create fulfillment order item
    const fulfillmentOrderItem = await this.createFulfillmentOrderItem({
      fulfillmentOrderId: fulfillmentOrder.id,
      skuId: sku.id,
      salesOrderId: salesOrder.id,
      salesOrderLineId: salesOrderLine.id
    });

    return {
      warehouse,
      sku,
      stock,
      salesOrder,
      salesOrderLine,
      fulfillmentOrder,
      fulfillmentOrderItem
    };
  }

  static async createReadyForPickingScenario() {
    const flow = await this.createCompleteOrderFlow({
      status: 'ready'
    });

    // Create stock reservation
    const reservation = await this.createStockReservation({
      skuId: flow.sku.id,
      fulfillmentOrderItemId: flow.fulfillmentOrderItem.id,
      quantity: flow.fulfillmentOrderItem.qty
    });

    return {
      ...flow,
      reservation
    };
  }

  static async createBatchWithMultipleOrders(orderCount: number = 3) {
    const warehouse = await this.createWarehouse();
    const batch = await this.createOutboundBatch({
      warehouseId: warehouse.id
    });

    const orders: Awaited<ReturnType<typeof this.createCompleteOrderFlow>>[] = [];
    for (let i = 0; i < orderCount; i++) {
      const flow = await this.createCompleteOrderFlow({
        warehouseId: warehouse.id,
        status: 'ready'
      });
      orders.push(flow);
    }

    return {
      warehouse,
      batch,
      orders
    };
  }

  // Simple scenario for testing basic functionality
  static async createSimpleScenario() {
    const warehouse = await this.createWarehouse();
    const sku = await this.createSku();

    return {
      warehouse,
      sku
    };
  }
}