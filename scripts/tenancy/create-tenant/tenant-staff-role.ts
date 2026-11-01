/**
 * 새 테넌트 직원 역할 — 창고·로케이션·SKU·상품 등록만. 역할은 전역이라 이름에 테넌트 이름을 쓰지 않는다.
 *
 * 주지 않는 것: `order.*`(단건 SKU 연결 패널이 Medusa 프록시로 테넌트 1 주문을 연다 — SKU 연결은 일괄 세션으로만),
 * `customer.profile.read`·`analytics.report.read`·`ai.assistant.use`·`inventory.stock.adjust`·`channel.*`·`master`.
 */
export const TENANT_STAFF_ROLE = {
  name: 'warehouse_catalog_staff',
  displayName: '창고·상품 담당',
  description: '창고·로케이션·SKU·상품 등록',
  landingPath: '/inventory/warehouses',
  permissions: [
    'inventory.stock.read',
    'inventory.warehouse.write',
    'inventory.master.read',
    'inventory.master.write',
    'catalog.product.read',
    'catalog.product.write',
    'catalog.category.write',
    'catalog.bulk.execute',
    'catalog.price.write',
  ],
} as const;
