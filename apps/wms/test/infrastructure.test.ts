import { WmsTestDatabase } from './support/wms-test-database';
import { WmsTestFactory } from './support/wms-test-factory';

describe('WMS Test Infrastructure', () => {
  it('should initialize database and create test data', async () => {
    // Test database connection
    const db = WmsTestDatabase.getDb();
    expect(db).toBeDefined();

    // Test basic factory functionality
    const warehouse = await WmsTestFactory.createWarehouse({
      name: 'Test Warehouse Infrastructure'
    });

    expect(warehouse).toBeDefined();
    expect(warehouse.id).toBeDefined();
    expect(warehouse.name).toBe('Test Warehouse Infrastructure');

    // Test table counts
    const counts = await WmsTestDatabase.getTableCounts();
    expect(counts.warehouses).toBe(1);
    expect(counts.skus).toBe(0);
  });

  it('should clear data between tests', async () => {
    // This test should start with empty tables
    const counts = await WmsTestDatabase.getTableCounts();
    expect(counts.warehouses).toBe(0);
    expect(counts.skus).toBe(0);
  });

  it('should create simple test scenarios', async () => {
    // Test simple factory method
    const scenario = await WmsTestFactory.createSimpleScenario();

    expect(scenario.warehouse).toBeDefined();
    expect(scenario.sku).toBeDefined();
    expect(scenario.warehouse.id).toBeDefined();
    expect(scenario.sku.id).toBeDefined();
    expect(scenario.sku.code).toMatch(/^SKU-/);
  });

  it('should handle SKU creation with custom data', async () => {
    const customSku = await WmsTestFactory.createSku({
      name: 'Custom Test SKU',
      code: 'CUSTOM-001'
    });

    expect(customSku.name).toBe('Custom Test SKU');
    expect(customSku.code).toBe('CUSTOM-001');
  });

  it('should create complete order flow scenario', async () => {
    const scenario = await WmsTestFactory.createCompleteOrderFlow();

    expect(scenario.warehouse).toBeDefined();
    expect(scenario.sku).toBeDefined();
    expect(scenario.stock).toBeDefined();
    expect(scenario.salesOrder).toBeDefined();
    expect(scenario.salesOrderLine).toBeDefined();
    expect(scenario.fulfillmentOrder).toBeDefined();
    expect(scenario.fulfillmentOrderItem).toBeDefined();

    // Verify relationships
    expect(scenario.stock.warehouseId).toBe(scenario.warehouse.id);
    expect(scenario.stock.skuId).toBe(scenario.sku.id);
    expect(scenario.fulfillmentOrder.warehouseId).toBe(scenario.warehouse.id);
    expect(scenario.fulfillmentOrderItem.fulfillmentOrderId).toBe(scenario.fulfillmentOrder.id);
    expect(scenario.fulfillmentOrderItem.skuId).toBe(scenario.sku.id);
  });

  it('should handle multiple orders in batch scenario', async () => {
    const batchScenario = await WmsTestFactory.createBatchWithMultipleOrders(3);

    expect(batchScenario.warehouse).toBeDefined();
    expect(batchScenario.batch).toBeDefined();
    expect(batchScenario.orders).toHaveLength(3);

    // All orders should be in the same warehouse
    batchScenario.orders.forEach(order => {
      expect(order.fulfillmentOrder.warehouseId).toBe(batchScenario.warehouse.id);
    });
  });

  it('should create ready for picking scenario with reservations', async () => {
    const scenario = await WmsTestFactory.createReadyForPickingScenario();

    expect(scenario.reservation).toBeDefined();
    expect(scenario.reservation.skuId).toBe(scenario.sku.id);
    expect(scenario.reservation.fulfillmentOrderItemId).toBe(scenario.fulfillmentOrderItem.id);
    expect(scenario.reservation.quantity).toBe(scenario.fulfillmentOrderItem.qty);
  });
});