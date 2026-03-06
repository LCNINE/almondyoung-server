// src/lib/mock/data/inventory.ts
// 재고 관련 Mock 데이터

import type {
    SupplierDto,
    WarehouseDto,
    HolderDto,
    InventoryMatchingResponseDto,
    ProductType,
    StockOwnerType,
} from '../../types/dto/inventory';

// SKU Mock 데이터 (백엔드 스펙에 맞게 완전 구현)
export const mockSkus = [
    {
        id: 'sku-001',
        name: '노몬드 속눈썹 펌지 100매 (5cm x 0.5cm)',
        code: 'NMD-LASH-001',
        defaultBarcode: '8801234567890',
        deliveryProfileId: 'delivery-profile-001',
        sale1m: 150,
        sale3m: 450,
        masterId: 'master-001',
        optionKey: { '타입': '기본', '크기': '5cm x 0.5cm' },
        master: { id: 'master-001', name: '노몬드 속눈썹 펌 시리즈' },
        barcodes: [
            {
                id: 'barcode-001',
                barcode: '8801234567890',
                barcodeType: 'standard',
                packingUnit: '1매'
            }
        ],
        supplierNames: ['자체제작'],
        categoryNames: ['속눈썹 관리'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-002',
        name: '노몬드 속눈썹 펌 솔루션 1',
        code: 'NMD-PERM-001',
        defaultBarcode: '8801234567891',
        deliveryProfileId: 'delivery-profile-001',
        sale1m: 120,
        sale3m: 360,
        masterId: 'master-001',
        optionKey: { '타입': '솔루션1', '용량': '30ml' },
        master: { id: 'master-001', name: '노몬드 속눈썹 펌 시리즈' },
        barcodes: [
            {
                id: 'barcode-002',
                barcode: '8801234567891',
                barcodeType: 'standard',
                packingUnit: '1병'
            }
        ],
        supplierNames: ['자체제작'],
        categoryNames: ['속눈썹 관리'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-003',
        name: '노몬드 속눈썹 펌 솔루션 2',
        code: 'NMD-PERM-002',
        defaultBarcode: '8801234567892',
        deliveryProfileId: 'delivery-profile-001',
        sale1m: 120,
        sale3m: 360,
        masterId: 'master-001',
        optionKey: { '타입': '솔루션2', '용량': '30ml' },
        master: { id: 'master-001', name: '노몬드 속눈썹 펌 시리즈' },
        barcodes: [
            {
                id: 'barcode-003',
                barcode: '8801234567892',
                barcodeType: 'standard',
                packingUnit: '1병'
            }
        ],
        supplierNames: ['자체제작'],
        categoryNames: ['속눈썹 관리'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-004',
        name: '노몬드 속눈썹 영양제 블랙',
        code: 'NMD-NUTRITION-001',
        defaultBarcode: '8801234567893',
        deliveryProfileId: 'delivery-profile-001',
        sale1m: 80,
        sale3m: 240,
        masterId: 'master-001',
        optionKey: { '타입': '영양제', '색상': '블랙' },
        master: { id: 'master-001', name: '노몬드 속눈썹 펌 시리즈' },
        barcodes: [
            {
                id: 'barcode-004',
                barcode: '8801234567893',
                barcodeType: 'standard',
                packingUnit: '1개'
            }
        ],
        supplierNames: ['자체제작'],
        categoryNames: ['속눈썹 관리'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-005',
        name: '젤로젤로 필요오프 베이스젤',
        code: 'JJ-BASE-001',
        defaultBarcode: '8801234567894',
        deliveryProfileId: 'delivery-profile-002',
        sale1m: 200,
        sale3m: 600,
        masterId: 'master-002',
        optionKey: { '타입': '베이스젤', '용량': '15g' },
        master: { id: 'master-002', name: '젤로젤로 네일 시리즈' },
        barcodes: [
            {
                id: 'barcode-005',
                barcode: '8801234567894',
                barcodeType: 'standard',
                packingUnit: '1개'
            }
        ],
        supplierNames: ['젤로젤로'],
        categoryNames: ['네일케어'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-006',
        name: '젤로젤로 우드스틱',
        code: 'JJ-STICK-001',
        defaultBarcode: '8801234567895',
        deliveryProfileId: 'delivery-profile-002',
        sale1m: 180,
        sale3m: 540,
        masterId: 'master-002',
        optionKey: { '타입': '우드스틱', '재질': '나무' },
        master: { id: 'master-002', name: '젤로젤로 네일 시리즈' },
        barcodes: [
            {
                id: 'barcode-006',
                barcode: '8801234567895',
                barcodeType: 'standard',
                packingUnit: '1개'
            }
        ],
        supplierNames: ['젤로젤로'],
        categoryNames: ['네일케어'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-007',
        name: '아몬드영 프리미엄 세트 본품',
        code: 'ALM-PREM-MAIN',
        defaultBarcode: '8801234567896',
        deliveryProfileId: 'delivery-profile-003',
        sale1m: 50,
        sale3m: 150,
        masterId: 'master-003',
        optionKey: { '타입': '프리미엄', '용량': '50ml' },
        master: { id: 'master-003', name: '아몬드영 스킨케어 시리즈' },
        barcodes: [
            {
                id: 'barcode-007',
                barcode: '8801234567896',
                barcodeType: 'standard',
                packingUnit: '1개'
            }
        ],
        supplierNames: ['아몬드영'],
        categoryNames: ['스킨케어'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-008',
        name: '아몬드영 베이직 세트 본품',
        code: 'ALM-BASIC-MAIN',
        defaultBarcode: '8801234567897',
        deliveryProfileId: 'delivery-profile-003',
        sale1m: 80,
        sale3m: 240,
        masterId: 'master-003',
        optionKey: { '타입': '베이직', '용량': '30ml' },
        master: { id: 'master-003', name: '아몬드영 스킨케어 시리즈' },
        barcodes: [
            {
                id: 'barcode-008',
                barcode: '8801234567897',
                barcodeType: 'standard',
                packingUnit: '1개'
            }
        ],
        supplierNames: ['아몬드영'],
        categoryNames: ['스킨케어'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-009',
        name: '일회용 립브러쉬 50개 (스카이)',
        code: 'LIP-BRUSH-SKY-50',
        defaultBarcode: '8801234567898',
        deliveryProfileId: 'delivery-profile-004',
        sale1m: 300,
        sale3m: 900,
        masterId: 'master-004',
        optionKey: { '타입': '립브러쉬', '색상': '스카이', '수량': '50개' },
        master: { id: 'master-004', name: '일회용 브러쉬 시리즈' },
        barcodes: [
            {
                id: 'barcode-009',
                barcode: '8801234567898',
                barcodeType: 'standard',
                packingUnit: '50개'
            }
        ],
        supplierNames: ['브러쉬코리아'],
        categoryNames: ['도구'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'sku-010',
        name: '일회용 립브러쉬 50개 (핑크)',
        code: 'LIP-BRUSH-PINK-50',
        defaultBarcode: '8801234567899',
        deliveryProfileId: 'delivery-profile-004',
        sale1m: 280,
        sale3m: 840,
        masterId: 'master-004',
        optionKey: { '타입': '립브러쉬', '색상': '핑크', '수량': '50개' },
        master: { id: 'master-004', name: '일회용 브러쉬 시리즈' },
        barcodes: [
            {
                id: 'barcode-010',
                barcode: '8801234567899',
                barcodeType: 'standard',
                packingUnit: '50개'
            }
        ],
        supplierNames: ['브러쉬코리아'],
        categoryNames: ['도구'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 재고 Mock 데이터 (백엔드 스펙에 맞게 구현)
export const mockStocks = [
    {
        skuId: 'sku-001',
        warehouseId: 'warehouse-001',
        locationId: 'location-001',
        stockType: 'physical',
        quantity: 100,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-002',
        warehouseId: 'warehouse-001',
        locationId: 'location-002',
        stockType: 'physical',
        quantity: 50,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-003',
        warehouseId: 'warehouse-001',
        locationId: 'location-003',
        stockType: 'physical',
        quantity: 75,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-004',
        warehouseId: 'warehouse-001',
        locationId: 'location-004',
        stockType: 'physical',
        quantity: 30,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-005',
        warehouseId: 'warehouse-002',
        locationId: 'location-005',
        stockType: 'physical',
        quantity: 200,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-006',
        warehouseId: 'warehouse-002',
        locationId: 'location-006',
        stockType: 'physical',
        quantity: 150,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-007',
        warehouseId: 'warehouse-003',
        locationId: 'location-007',
        stockType: 'physical',
        quantity: 25,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-008',
        warehouseId: 'warehouse-003',
        locationId: 'location-008',
        stockType: 'physical',
        quantity: 40,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-009',
        warehouseId: 'warehouse-004',
        locationId: 'location-009',
        stockType: 'physical',
        quantity: 500,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-010',
        warehouseId: 'warehouse-004',
        locationId: 'location-010',
        stockType: 'physical',
        quantity: 450,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
];

// 재고 요약 Mock 데이터 (백엔드 스펙에 맞게 구현)
export const mockStockSummaries = [
    {
        skuId: 'sku-001',
        skuName: '노몬드 속눈썹 펌지 100매 (5cm x 0.5cm)',
        warehouseId: 'warehouse-001',
        warehouseName: '본사 창고',
        currentQuantity: 100,
        availableQuantity: 95,
        reservedQuantity: 5,
        inboundPendingQuantity: 0,
        outboundPendingQuantity: 0,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-002',
        skuName: '노몬드 속눈썹 펌 솔루션 1',
        warehouseId: 'warehouse-001',
        warehouseName: '본사 창고',
        currentQuantity: 50,
        availableQuantity: 45,
        reservedQuantity: 5,
        inboundPendingQuantity: 0,
        outboundPendingQuantity: 0,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-003',
        skuName: '노몬드 속눈썹 펌 솔루션 2',
        warehouseId: 'warehouse-001',
        warehouseName: '본사 창고',
        currentQuantity: 75,
        availableQuantity: 70,
        reservedQuantity: 5,
        inboundPendingQuantity: 0,
        outboundPendingQuantity: 0,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-004',
        skuName: '노몬드 속눈썹 영양제 블랙',
        warehouseId: 'warehouse-001',
        warehouseName: '본사 창고',
        currentQuantity: 30,
        availableQuantity: 25,
        reservedQuantity: 5,
        inboundPendingQuantity: 0,
        outboundPendingQuantity: 0,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
    {
        skuId: 'sku-005',
        skuName: '젤로젤로 필요오프 베이스젤',
        warehouseId: 'warehouse-002',
        warehouseName: '지점 창고',
        currentQuantity: 200,
        availableQuantity: 190,
        reservedQuantity: 10,
        inboundPendingQuantity: 0,
        outboundPendingQuantity: 0,
        lastUpdated: '2024-01-01T00:00:00Z',
    },
];

// SKU별 총 재고 Mock 데이터
export const mockSkuTotalStocks = [
    {
        skuId: 'sku-001',
        totalRealQuantity: 100,
        totalReservedQuantity: 5,
        totalAvailableQuantity: 95,
    },
    {
        skuId: 'sku-002',
        totalRealQuantity: 50,
        totalReservedQuantity: 5,
        totalAvailableQuantity: 45,
    },
    {
        skuId: 'sku-003',
        totalRealQuantity: 75,
        totalReservedQuantity: 5,
        totalAvailableQuantity: 70,
    },
];

// SKU별 창고 재고 상세 Mock 데이터
export const mockSkuWarehouseStocks = [
    {
        summary: {
            skuId: 'sku-001',
            skuName: '노몬드 속눈썹 펌지 100매 (5cm x 0.5cm)',
            warehouseId: 'warehouse-001',
            warehouseName: '본사 창고',
            currentQuantity: 100,
            availableQuantity: 95,
            reservedQuantity: 5,
            inboundPendingQuantity: 0,
            outboundPendingQuantity: 0,
            movingQuantity: 0,
            defectiveQuantity: 0,
            returnPendingQuantity: 0,
            lastUpdated: '2024-01-01T00:00:00Z',
        },
        details: [
            {
                id: 'stock-detail-001',
                realQuantity: 100,
                reservedQuantity: 5,
                availableQuantity: 95,
                location: { id: 'location-001', code: 'A-01-01' },
                expiryDate: '2025-12-31T00:00:00Z',
            },
        ],
    },
];

// 재고 이력 Mock 데이터
export const mockStockHistories = [
    {
        id: 'history-001',
        eventType: 'inbound',
        deltaQuantity: 100,
        eventTimestamp: '2024-01-01T00:00:00Z',
        reason: '입고',
        orderId: 'order-001',
    },
    {
        id: 'history-002',
        eventType: 'outbound',
        deltaQuantity: -5,
        eventTimestamp: '2024-01-02T00:00:00Z',
        reason: '출고',
        orderId: 'order-002',
    },
];

// 창고 Mock 데이터 (백엔드 스펙에 맞게 구현)
export const mockWarehouses = [
    {
        id: 'warehouse-001',
        name: '본사 창고',
        type: 'domestic',
        location: '서울시 강남구',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'warehouse-002',
        name: '지점 창고',
        type: 'domestic',
        location: '경기도 성남시 분당구',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'warehouse-003',
        name: '해외 창고',
        type: 'overseas',
        location: '중국 상하이',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'warehouse-004',
        name: '보세 창고',
        type: 'bonded',
        location: '인천국제공항',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'warehouse-005',
        name: '반품 창고',
        type: 'return',
        location: '경기도 안양시',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 창고별 재고 요약 Mock 데이터
export const mockWarehouseStockSummaries = [
    {
        warehouseId: 'warehouse-001',
        warehouseName: '본사 창고',
        totalSkus: 4,
        totalQuantity: 255,
        totalAvailableQuantity: 235,
        totalReservedQuantity: 20,
    },
    {
        warehouseId: 'warehouse-002',
        warehouseName: '지점 창고',
        totalSkus: 2,
        totalQuantity: 350,
        totalAvailableQuantity: 340,
        totalReservedQuantity: 10,
    },
    {
        warehouseId: 'warehouse-003',
        warehouseName: '해외 창고',
        totalSkus: 2,
        totalQuantity: 65,
        totalAvailableQuantity: 60,
        totalReservedQuantity: 5,
    },
    {
        warehouseId: 'warehouse-004',
        warehouseName: '보세 창고',
        totalSkus: 2,
        totalQuantity: 950,
        totalAvailableQuantity: 940,
        totalReservedQuantity: 10,
    },
];

// 입고 Mock 데이터
export const mockInbounds = [
    {
        id: 'inbound-1',
        warehouseId: 'warehouse-1',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 검수 Mock 데이터
export const mockInspections = [
    {
        id: 'inspection-1',
        inboundId: 'inbound-1',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 이동 Mock 데이터
export const mockMovements = [
    {
        id: 'movement-1',
        skuId: 'sku-001',
        fromWarehouseId: 'warehouse-1',
        toWarehouseId: 'warehouse-2',
        quantity: 10,
        status: 'completed',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 통합 Mock 데이터
export const mockConsolidations = [
    {
        id: 'consolidation-1',
        warehouseId: 'warehouse-1',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 매칭 Mock 데이터 (백엔드 스펙에 맞게 구현)
export const mockMatchings = [
    {
        id: 'matching-001',
        sellingProductId: 'product-001',
        sellingProductName: '노몬드 속눈썹 펌지 100매 (5cm x 0.5cm)',
        sellingProductOption: '기본',
        linkedSkus: [
            {
                skuId: 'sku-001',
                skuName: '노몬드 속눈썹 펌지 100매 (5cm x 0.5cm)',
                quantity: 1,
                supplier: { id: 'supplier-001', name: '자체제작' }
            }
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'matching-002',
        sellingProductId: 'product-002',
        sellingProductName: '젤로젤로 필요오프 베이스젤',
        sellingProductOption: '15g',
        linkedSkus: [
            {
                skuId: 'sku-005',
                skuName: '젤로젤로 필요오프 베이스젤',
                quantity: 1,
                supplier: { id: 'supplier-002', name: '젤로젤로' }
            }
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'matching-003',
        sellingProductId: 'product-003',
        sellingProductName: '아몬드영 프리미엄 세트',
        sellingProductOption: '50ml',
        linkedSkus: [
            {
                skuId: 'sku-007',
                skuName: '아몬드영 프리미엄 세트 본품',
                quantity: 1,
                supplier: { id: 'supplier-003', name: '아몬드영' }
            },
            {
                skuId: 'sku-009',
                skuName: '일회용 립브러쉬 50개 (스카이)',
                quantity: 1,
                supplier: { id: 'supplier-004', name: '브러쉬코리아' }
            }
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 매칭 이력 Mock 데이터
export const mockMatchingHistories = [
    {
        id: 'history-001',
        matchingId: 'matching-001',
        action: 'created',
        description: '매칭 생성',
        timestamp: '2024-01-01T00:00:00Z',
        userId: 'user-001',
        userName: '관리자',
    },
    {
        id: 'history-002',
        matchingId: 'matching-001',
        action: 'updated',
        description: '수량 변경: 1 → 2',
        timestamp: '2024-01-02T00:00:00Z',
        userId: 'user-001',
        userName: '관리자',
    },
    {
        id: 'history-003',
        matchingId: 'matching-002',
        action: 'created',
        description: '매칭 생성',
        timestamp: '2024-01-01T00:00:00Z',
        userId: 'user-002',
        userName: '운영자',
    },
];

// 매칭 통계 Mock 데이터
export const mockMatchingStats = {
    totalMatchings: 3,
    activeMatchings: 3,
    inactiveMatchings: 0,
    recentlyCreated: 2,
    recentlyUpdated: 1,
    averageSkusPerMatching: 1.3,
};

// ===== 자동재고매칭 관련 데이터 (기존 inventory-matching에서 통합) =====

// 상품구분 옵션
export const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
    { value: '일반상품', label: '일반상품' },
    { value: '세트상품', label: '세트상품' },
    { value: '디지털상품', label: '디지털상품' },
];

// 물류처(창고) 목업 데이터 (자동재고매칭용)
export const mockInventoryMatchingWarehouses: WarehouseDto[] = [
    {
        id: 'warehouse-1',
        name: '부천창고',
        type: 'domestic',
        location: '경기도 부천시',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'warehouse-2',
        name: '중국창고',
        type: 'overseas',
        location: '중국 광저우',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'warehouse-3',
        name: '보세창고',
        type: 'bonded',
        location: '인천국제공항',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'warehouse-4',
        name: '반품창고',
        type: 'return',
        location: '경기도 안양시',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 공급처 목업 데이터
export const mockSuppliers: SupplierDto[] = [
    {
        id: 'supplier-1',
        name: '자체제작',
        contactInfo: {
            phone: '02-1234-5678',
            email: 'self@almondyoung.com',
            address: '서울시 강남구',
        },
        defaultWarehouseId: 'warehouse-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'supplier-2',
        name: 'A공급사',
        contactInfo: {
            phone: '02-2345-6789',
            email: 'supplier-a@example.com',
            address: '경기도 성남시',
        },
        defaultWarehouseId: 'warehouse-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'supplier-3',
        name: 'B공급사',
        contactInfo: {
            phone: '02-3456-7890',
            email: 'supplier-b@example.com',
            address: '경기도 수원시',
        },
        defaultWarehouseId: 'warehouse-2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'supplier-4',
        name: 'C공급사',
        contactInfo: {
            phone: '02-4567-8901',
            email: 'supplier-c@example.com',
            address: '부산시 해운대구',
        },
        defaultWarehouseId: 'warehouse-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'supplier-5',
        name: '해외공급사',
        contactInfo: {
            phone: '+86-20-1234-5678',
            email: 'overseas@example.com',
            address: '중국 광저우시',
        },
        defaultWarehouseId: 'warehouse-2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 재고소유 목업 데이터
export const mockHolders: HolderDto[] = [
    {
        id: 'holder-1',
        name: '엘씨나인',
        isOurAsset: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'holder-2',
        name: '위탁업체A',
        isOurAsset: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'holder-3',
        name: '위탁업체B',
        isOurAsset: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'holder-4',
        name: '직송업체',
        isOurAsset: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 재고소유 옵션 (UI용) - 자사/3PL 구분
export const STOCK_OWNER_OPTIONS: { value: string; label: string }[] = [
    { value: 'holder-1', label: '자사(엘씨나인)' },
    { value: 'holder-2', label: '3PL(위탁업체A)' },
    { value: 'holder-3', label: '3PL(위탁업체B)' },
    { value: 'holder-4', label: '3PL(직송업체)' },
];

// 자동재고매칭 목업 데이터 (백엔드 스펙에 맞게 구현)
export const mockInventoryMatchings: InventoryMatchingResponseDto[] = [
    {
        id: 'inventory-matching-001',
        sellingProductId: 'product-001',
        sellingProductName: '노몬드 속눈썹 펌지 100매 (5cm x 0.5cm)',
        sellingProductOption: '기본',
        productType: '일반상품' as ProductType,
        supplierId: 'supplier-001',
        supplierName: '자체제작',
        stockOwnerId: 'holder-001',
        stockOwnerName: '아몬드영',
        warehouseId: 'warehouse-001',
        warehouseName: '본사 창고',
        skuMappings: [
            {
                skuId: 'sku-001',
                skuName: '노몬드 속눈썹 펌지 100매 (5cm x 0.5cm)',
                quantity: 1,
            }
        ],
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'inventory-matching-002',
        sellingProductId: 'product-002',
        sellingProductName: '젤로젤로 필요오프 베이스젤',
        sellingProductOption: '15g',
        productType: '일반상품' as ProductType,
        supplierId: 'supplier-002',
        supplierName: '젤로젤로',
        stockOwnerId: 'holder-001',
        stockOwnerName: '아몬드영',
        warehouseId: 'warehouse-002',
        warehouseName: '지점 창고',
        skuMappings: [
            {
                skuId: 'sku-005',
                skuName: '젤로젤로 필요오프 베이스젤',
                quantity: 1,
            }
        ],
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'inventory-matching-003',
        sellingProductId: 'product-003',
        sellingProductName: '아몬드영 프리미엄 세트',
        sellingProductOption: '50ml',
        productType: '세트상품' as ProductType,
        supplierId: 'supplier-003',
        supplierName: '아몬드영',
        stockOwnerId: 'holder-001',
        stockOwnerName: '아몬드영',
        warehouseId: 'warehouse-003',
        warehouseName: '해외 창고',
        skuMappings: [
            {
                skuId: 'sku-007',
                skuName: '아몬드영 프리미엄 세트 본품',
                quantity: 1,
            },
            {
                skuId: 'sku-009',
                skuName: '일회용 립브러쉬 50개 (스카이)',
                quantity: 1,
            }
        ],
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// 자동재고매칭 통계 Mock 데이터
export const mockInventoryMatchingStats = {
    totalMatchings: 3,
    activeMatchings: 3,
    inactiveMatchings: 0,
    byProductType: {
        '일반상품': 2,
        '세트상품': 1,
        '디지털상품': 0,
    },
    bySupplier: {
        '자체제작': 1,
        '젤로젤로': 1,
        '아몬드영': 1,
    },
    byWarehouse: {
        '본사 창고': 1,
        '지점 창고': 1,
        '해외 창고': 1,
    },
    averageSkusPerMatching: 1.3,
    recentlyCreated: 2,
    recentlyUpdated: 1,
};

// 검색용 헬퍼 함수들
export const searchSuppliers = (query: string): SupplierDto[] => {
    if (!query) return mockSuppliers;
    return mockSuppliers.filter(supplier =>
        supplier.name.toLowerCase().includes(query.toLowerCase()) ||
        supplier.contactInfo?.email?.toLowerCase().includes(query.toLowerCase())
    );
};

export const searchHolders = (query: string, isOurAsset?: boolean): HolderDto[] => {
    let filtered = mockHolders;

    if (query) {
        filtered = filtered.filter(holder =>
            holder.name.toLowerCase().includes(query.toLowerCase())
        );
    }

    if (isOurAsset !== undefined) {
        filtered = filtered.filter(holder => holder.isOurAsset === isOurAsset);
    }

    return filtered;
};

// 페이지네이션 헬퍼 함수
export const paginateResults = <T>(
    data: T[],
    page: number = 1,
    limit: number = 10
): { data: T[]; total: number; page: number; limit: number } => {
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    return {
        data: data.slice(startIndex, endIndex),
        total: data.length,
        page,
        limit,
    };
};