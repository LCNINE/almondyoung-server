import { WmsTestDatabase } from './wms-test-database';
import {
  wmsTables,
  wmsSchema,
  wmsViews,
  type Warehouse,
  type NewWarehouse,
  type Sku,
  type NewSku,
  type Holder,
  type NewHolder,
  type Supplier,
  type NewSupplier,
  type StockSummary,
  type SalesOrder,
  type NewSalesOrder,
  type SalesOrderLine,
  type NewSalesOrderLine,
  type FulfillmentOrder,
  type NewFulfillmentOrder,
  type FulfillmentOrderItem,
  type NewFulfillmentOrderItem,
  type OutboundBatch,
  type NewOutboundBatch,
  type StockReservation,
  type NewStockReservation,
  type Location,
  type NewLocation,
  type InventoryProductMaster,
  type NewInventoryProductMaster,
  type StockEvent,
  type NewStockEvent,
  type StockLedger,
  type NewStockLedger,
  type Category,
  type NewCategory,
  type ProductSkuMappingSnapshot,
  type NewProductSkuMappingSnapshot,
} from '../../database/schemas/wms-schema';
import { faker } from '@faker-js/faker';

export class WmsTestFactory {
  private static get db() {
    return WmsTestDatabase.getDb();
  }

  private static getDb() {
    return WmsTestDatabase.getDb();
  }

  // Warehouse Factory
  static async createWarehouse(overrides: Partial<NewWarehouse> = {}): Promise<Warehouse> {
    const warehouse: NewWarehouse = {
      name: faker.company.name() + ' Warehouse',
      location: faker.location.streetAddress(),
      type: 'domestic',
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.warehouses)
      .values(warehouse)
      .returning();

    return created;
  }

  // SKU Factory
  static async createSku(overrides: Partial<NewSku> = {}): Promise<Sku> {
    // ensure master
    let masterId = overrides.masterId;
    if (!masterId) {
      const masterCode = `M-${faker.string.alphanumeric(6).toUpperCase()}`;
      const master: NewInventoryProductMaster = {
        name: faker.commerce.productName(),
        masterCode,
        status: 'active'
      };
      const [createdMaster] = await this.db.insert(wmsTables.inventoryProductMasters)
        .values(master)
        .returning();
      masterId = createdMaster.id;
    }

    const sku: NewSku = {
      name: faker.commerce.productName(),
      code: `SKU-${faker.string.alphanumeric(8)}`,
      holderId: '00000000-0000-0000-0000-000000000000',
      stockType: 'physical',
      masterId,
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.skus)
      .values(sku)
      .returning();

    return created;
  }

  // Holder Factory
  static async createHolder(overrides: Partial<NewHolder> = {}): Promise<Holder> {
    const holder: NewHolder = {
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
  static async createSupplier(overrides: Partial<NewSupplier> = {}): Promise<Supplier> {
    const supplier: NewSupplier = {
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
  // Note: stockSummary is a view, so we create stock via stockEvents and return a mock summary
  static async createStock(overrides: Partial<{ warehouseId?: string; skuId?: string; onHandQty?: number; availableQty?: number; reservedQty?: number }> = {}): Promise<StockSummary> {
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

    const onHandQty = overrides.onHandQty ?? faker.number.int({ min: 10, max: 100 });
    const availableQty = overrides.availableQty ?? faker.number.int({ min: 5, max: 50 });
    const reservedQty = overrides.reservedQty ?? 0;

    // Create actual stock via stockEvent
    await this.createStockEvent({
      skuId,
      toWarehouseId: warehouseId,
      toState: 'ON_HAND',
      transitionType: 'RECEIVE',
      quantity: onHandQty,
    });

    // Return a mock StockSummary object
    return {
      skuId,
      warehouseId,
      skuName: null,
      warehouseName: null,
      onHandQty,
      availableQty,
      reservedQty,
      inboundPendingQty: 0,
      defectiveQty: 0,
      inTransferQty: 0,
      onOrderQty: 0,
      transferPendingQty: 0,
      projectedAvailableQty: availableQty,
      lastCalculatedAt: new Date(),
    };
  }

  // Sales Order Factory
  static async createSalesOrder(overrides: Partial<NewSalesOrder> = {}): Promise<SalesOrder> {
    const salesOrder: NewSalesOrder = {
      channelOrderId: `SO-${faker.string.alphanumeric(8)}`,
      salesChannel: 'medusa',
      customerName: faker.person.fullName(),
      customerEmail: faker.internet.email(),
      status: 'pending',
      shippingAddress: {
        name: faker.person.fullName(),
        phone: faker.phone.number(),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        postalCode: faker.location.zipCode()
      },
      orderDate: new Date(),
      totalAmount: faker.number.int({ min: 10000, max: 100000 }),
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.salesOrders)
      .values(salesOrder)
      .returning();

    return created;
  }

  // Sales Order Line Factory
  static async createSalesOrderLine(overrides: Partial<NewSalesOrderLine> = {}): Promise<SalesOrderLine> {
    let salesOrderId = overrides.salesOrderId;
    let variantId = overrides.variantId;

    if (!salesOrderId) {
      const salesOrder = await this.createSalesOrder();
      salesOrderId = salesOrder.id;
    }

    if (!variantId) {
      variantId = faker.string.uuid();
    }

    const line: NewSalesOrderLine = {
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
  static async createFulfillmentOrder(overrides: Partial<NewFulfillmentOrder> = {}): Promise<FulfillmentOrder> {
    let warehouseId = overrides.warehouseId;

    if (!warehouseId) {
      const warehouse = await this.createWarehouse();
      warehouseId = warehouse.id;
    }

    const fulfillmentOrder: NewFulfillmentOrder = {
      warehouseId,
      status: 'created',
      ...overrides
    };

    const [created] = await this.db.insert(wmsTables.fulfillmentOrders)
      .values(fulfillmentOrder)
      .returning();

    return created;
  }

  // Fulfillment Order Item Factory
  static async createFulfillmentOrderItem(overrides: Partial<NewFulfillmentOrderItem> = {}): Promise<FulfillmentOrderItem> {
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
      const snapshot: NewProductSkuMappingSnapshot = {
        productId: `product-${faker.string.alphanumeric(8)}`,
        variantId: faker.string.uuid(),
        sourceVersion: 1,
        warehouseId: warehouse.id,
        quantity: 1,
        snapshotData: {
          items: [{ skuId, qtyPerProduct: 1 }]
        }
      };
      const [createdSnapshot] = await this.db.insert(wmsTables.productSkuMappingSnapshots)
        .values(snapshot)
        .returning();
      mappingSnapshotId = createdSnapshot.id;
    }

    const item: NewFulfillmentOrderItem = {
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
  static async createOutboundBatch(overrides: Partial<NewOutboundBatch> = {}): Promise<OutboundBatch> {
    let warehouseId = overrides.warehouseId;

    if (!warehouseId) {
      const warehouse = await this.createWarehouse();
      warehouseId = warehouse.id;
    }

    const batch: NewOutboundBatch = {
      batchNumber: `BATCH-${faker.string.alphanumeric(6)}`,
      warehouseId,
      pickingMethod: 'individual',
      status: 'created',
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
  static async createStockReservation(overrides: Partial<NewStockReservation> = {}): Promise<StockReservation> {
    let skuId = overrides.skuId;
    let fulfillmentOrderItemId = overrides.fulfillmentOrderItemId;
    let warehouseId = overrides.warehouseId;

    if (!skuId) {
      const sku = await this.createSku();
      skuId = sku.id;
    }

    if (!warehouseId) {
      const warehouse = await this.createWarehouse();
      warehouseId = warehouse.id;
    }

    if (!fulfillmentOrderItemId) {
      const foi = await this.createFulfillmentOrderItem({ skuId });
      fulfillmentOrderItemId = foi.id;
    }

    const reservation: NewStockReservation = {
      targetType: 'FULFILLMENT_ORDER',
      targetId: fulfillmentOrderItemId,
      skuId,
      warehouseId,
      fulfillmentOrderItemId,
      quantity: faker.number.int({ min: 1, max: 10 }),
      status: 'pending',
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
      onHandQty: 100,
      availableQty: 100
    });

    // Create sales order
    const salesOrder = await this.createSalesOrder();
    const salesOrderLine = await this.createSalesOrderLine({
      salesOrderId: salesOrder.id
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

  // Enhanced factory methods for complex test scenarios

  /**
   * Create stock at a specific location with full hierarchy
   */
  static async createStockWithLocation(overrides: Partial<any> = {}) {
    const warehouse = await this.createWarehouse();
    const sku = overrides.sku || await this.createSku();

    const db = this.getDb();
    const locationData: NewLocation = {
      warehouseId: overrides.warehouseId || warehouse.id,
      code: overrides.locationCode || `LOC-${Math.random().toString(36).slice(2, 8)}`,
      locationType: overrides.locationType || 'zone',
    };
    const [location] = await db.insert(wmsTables.locations).values(locationData).returning();

    const stock = await this.createStock({
      warehouseId: overrides.warehouseId || warehouse.id,
      skuId: sku.id,
      onHandQty: overrides.onHandQty || 100,
      availableQty: overrides.availableQty || 100,
      reservedQty: overrides.reservedQty || 0,
    });

    const ledgerData: NewStockLedger = {
      skuId: sku.id,
      warehouseId: overrides.warehouseId || warehouse.id,
      locationId: location.id,
      qty: overrides.onHandQty || 100,
      stockState: 'ON_HAND',
    };
    await db.insert(wmsTables.stockLedgers).values(ledgerData);

    return {
      warehouse,
      sku,
      location,
      stock,
    };
  }

  /**
   * Create SKU with supplier associations
   */
  static async createSkuWithSuppliers(supplierCount: number = 2, overrides: Partial<NewSku> & { withCategories?: boolean } = {}) {
    const suppliers: Supplier[] = [];
    for (let i = 0; i < supplierCount; i++) {
      const supplier = await this.createSupplier({
        name: `Supplier ${i + 1}`,
      });
      suppliers.push(supplier);
    }

    const db = this.getDb();
    const categories: Category[] = [];
    if (overrides.withCategories) {
      for (let i = 0; i < 2; i++) {
        const categoryData: NewCategory = {
          name: `Category ${i + 1}`,
        };
        const [category] = await db.insert(wmsTables.categories).values(categoryData).returning();
        categories.push(category);
      }
    }

    const { withCategories, ...skuOverrides } = overrides;
    const sku = await this.createSku({
      name: overrides.name || 'Multi-Source Product',
      code: overrides.code || `MULTI-${Math.random().toString(36).slice(2, 8)}`,
      ...skuOverrides,
    });

    for (const supplier of suppliers) {
      await db.insert(wmsTables.skuSuppliers).values({
        skuId: sku.id,
        supplierId: supplier.id,
      });
    }

    if (categories.length > 0) {
      for (const category of categories) {
        await db.insert(wmsTables.skuCategories).values({
          skuId: sku.id,
          categoryId: category.id,
        });
      }
    }

    return {
      sku,
      suppliers,
      categories,
    };
  }

  /**
   * Create complete location hierarchy: Zone > Column > Rack > Bins
   */
  static async createLocationHierarchy(
    warehouseId?: string,
    overrides: Partial<any> & {
      zoneCode?: string;
      zoneName?: string;
      columnCode?: string;
      columnName?: string;
      rackCode?: string;
      rackName?: string;
      zone?: string;
      rows?: number;
      levels?: number;
      depth?: number;
    } = {}
  ) {
    const warehouse = warehouseId ? { id: warehouseId } : await this.createWarehouse();

    const db = this.getDb();

    const zoneData: NewLocation = {
      warehouseId: warehouse.id,
      code: overrides.zoneCode || 'ZONE-A',
      displayName: overrides.zoneName || 'Zone A',
      locationType: 'zone',
    };
    const [zone] = await db.insert(wmsTables.locations).values(zoneData).returning();

    const columnData: NewLocation = {
      warehouseId: warehouse.id,
      code: overrides.columnCode || 'COL-A1',
      displayName: overrides.columnName || 'Column A1',
      locationType: 'zone',
    };
    const [column] = await db.insert(wmsTables.locations).values(columnData).returning();

    const rackData: NewLocation = {
      warehouseId: warehouse.id,
      code: overrides.rackCode || 'RACK-A1-1',
      displayName: overrides.rackName || 'Rack A1-1',
      locationType: 'zone',
    };
    const [rack] = await db.insert(wmsTables.locations).values(rackData).returning();

    const bins: Location[] = [];
    const rows = overrides.rows || 2;
    const levels = overrides.levels || 3;
    const depth = overrides.depth || 1;

    for (let row = 1; row <= rows; row++) {
      for (let level = 1; level <= levels; level++) {
        for (let d = 1; d <= depth; d++) {
          const binCode = `${rack.code}-A${row}-L${level}${depth > 1 ? `-D${d}` : ''}`;
          const binData: NewLocation = {
            warehouseId: warehouse.id,
            code: binCode,
            displayName: `Bin ${binCode}`,
            locationType: 'zone',
          };
          const [bin] = await db.insert(wmsTables.locations).values(binData).returning();
          bins.push(bin);
        }
      }
    }

    return {
      warehouse,
      zone,
      column,
      rack,
      bins,
    };
  }

  /**
   * Create master with specific properties
   */
  static async createMaster(overrides: Partial<NewInventoryProductMaster> = {}): Promise<InventoryProductMaster> {
    const db = this.getDb();
    const masterData: NewInventoryProductMaster = {
      name: overrides.name || `Master ${Math.random().toString(36).slice(2, 8)}`,
      masterCode: overrides.masterCode || `M-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      status: overrides.status || 'active',
      ...overrides,
    };
    const [master] = await db.insert(wmsTables.inventoryProductMasters).values(masterData).returning();

    return master;
  }

  /**
   * Create reservation for testing (alias for createStockReservation)
   */
  static async createReservation(overrides: Partial<any> = {}) {
    return this.createStockReservation(overrides);
  }

  /**
   * Create stock event directly
   */
  static async createStockEvent(overrides: Partial<NewStockEvent> & { warehouse?: Warehouse; sku?: Sku } = {}): Promise<StockEvent> {
    const warehouse = overrides.warehouse || await this.createWarehouse();
    const sku = overrides.sku || await this.createSku();

    const db = this.getDb();
    const { warehouse: _, sku: __, ...eventOverrides } = overrides;
    const eventData: NewStockEvent = {
      skuId: sku.id,
      toWarehouseId: overrides.toWarehouseId || warehouse.id,
      toLocationId: overrides.toLocationId || null,
      toState: overrides.toState || 'ON_HAND',
      transitionType: overrides.transitionType || 'RECEIVE',
      quantity: overrides.quantity || 100,
      occurredAt: overrides.occurredAt || new Date(),
      reason: overrides.reason,
      ...eventOverrides,
    };
    const [event] = await db.insert(wmsTables.stockEvents).values(eventData).returning();

    return event;
  }

  /**
   * Create stock ledger entry directly
   */
  static async createStockLedger(overrides: Partial<NewStockLedger> & { warehouse?: Warehouse; sku?: Sku } = {}) {
    const warehouse = overrides.warehouse || await this.createWarehouse();
    const sku = overrides.sku || await this.createSku();

    const db = this.getDb();
    const locationData: NewLocation = {
      warehouseId: warehouse.id,
      code: `LEDGER-LOC-${Math.random().toString(36).slice(2, 6)}`,
      locationType: 'zone',
    };
    const [location] = await db.insert(wmsTables.locations).values(locationData).returning();

    const { warehouse: _, sku: __, ...ledgerOverrides } = overrides;
    const ledgerData: NewStockLedger = {
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: overrides.locationId || location.id,
      qty: overrides.qty || 100,
      stockState: overrides.stockState || 'ON_HAND',
      updatedAt: overrides.updatedAt || new Date(),
      ...ledgerOverrides,
    };
    const [ledger] = await db.insert(wmsTables.stockLedgers).values(ledgerData).returning();

    return {
      ledger,
      warehouse,
      sku,
      location,
    };
  }
}