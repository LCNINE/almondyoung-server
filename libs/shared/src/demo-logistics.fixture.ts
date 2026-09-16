export const DEMO_LOGISTICS_FIXTURE_VERSION = 'demo-logistics-v1';

export function demoUuid(namespace: number, ordinal: number): string {
  const value = String(ordinal).padStart(4, '0');
  const tail = String(ordinal).padStart(12, '0');
  return `019f100${namespace}-${value}-7000-a000-${tail}`;
}

const catalog = Array.from({ length: 30 }, (_, offset) => {
  const ordinal = offset + 1;
  const label = String(ordinal).padStart(2, '0');
  return {
    masterId: demoUuid(1, ordinal),
    versionId: demoUuid(2, ordinal),
    variantId: demoUuid(3, ordinal),
    skuId: demoUuid(4, ordinal),
    matchingId: demoUuid(5, ordinal),
    sku: `DEMO-SKU-${String(ordinal).padStart(3, '0')}`,
    productName: `데모 물류 상품 ${label}`,
    unitPrice: 10_000 + offset * 500,
    availableQuantity: ordinal <= 5 ? 2 : 40 + ordinal,
    supplierIndex: offset % 3,
  };
});

export const DEMO_LOGISTICS_FIXTURE = {
  version: DEMO_LOGISTICS_FIXTURE_VERSION,
  demandDays: 365,
  warehouses: [
    { id: demoUuid(6, 1), name: '데모 국내 물류센터', type: 'domestic', isSellable: true },
    { id: demoUuid(6, 2), name: '데모 해외 조달창고', type: 'overseas', isSellable: false },
  ],
  locations: [
    ['입고대기', 'DEMO-RECEIVING', 1, true, 'inbound_default'],
    ['출고작업', 'DEMO-SHIPPING', 1, false, null],
    ['A-01-01', 'DEMO-A-01-01', 1, false, null],
    ['불량', 'DEMO-DAMAGE', 1, false, null],
    ['반품', 'DEMO-RETURN', 1, true, 'return_default'],
    ['해외입고', 'DEMO-OS-RECEIVING', 2, true, 'inbound_default'],
    ['해외보관', 'DEMO-OS-STORAGE', 2, false, null],
    ['해외반품', 'DEMO-OS-RETURN', 2, true, 'return_default'],
  ].map(([displayName, code, warehouseOrdinal, isSystem, systemRole], offset) => ({
    id: demoUuid(7, offset + 1),
    displayName: String(displayName),
    code: String(code),
    warehouseId: demoUuid(6, Number(warehouseOrdinal)),
    isSystem: Boolean(isSystem),
    systemRole: systemRole as 'inbound_default' | 'return_default' | null,
  })),
  suppliers: [
    {
      id: demoUuid(8, 1),
      code: 'DEMO-DOM',
      name: '데모 국내 공급사',
      defaultWarehouseIndex: 0,
      leadTimeDays: [3, 4, 3, 5, 4],
    },
    {
      id: demoUuid(8, 2),
      code: 'DEMO-SEA',
      name: '데모 해상 공급사',
      defaultWarehouseIndex: 1,
      leadTimeDays: [18, 21, 19, 23, 20],
    },
    {
      id: demoUuid(8, 3),
      code: 'DEMO-AIR',
      name: '데모 항공 공급사',
      defaultWarehouseIndex: 1,
      leadTimeDays: [7, 8, 6, 9, 7],
    },
  ],
  catalog,
} as const;
