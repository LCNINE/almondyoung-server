// src/lib/mock/data/orders.ts
// 주문 관련 Mock 데이터

import type {
    MatchingDto,
    MatchingsResponseDto,
    VariantMatchingDto,
    StockPolicyDto,
    VariantSkuLookupResponseDto,
} from '@/lib/types/dto/orders';

// 주문 Mock 데이터
export const mockOrders = [
    {
        id: 'order-1',
        order_number: 'ORD-2024-001',
        customer_id: 'customer-1',
        status: 'pending',
        total_amount: 1200000,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
    {
        id: 'order-2',
        order_number: 'ORD-2024-002',
        customer_id: 'customer-2',
        status: 'processing',
        total_amount: 1400000,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// 출고 배치 Mock 데이터
export const mockOutboundBatches = [
    {
        id: 'batch-1',
        warehouse_id: 'warehouse-1',
        status: 'pending',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// 피킹 Mock 데이터
export const mockPickings = [
    {
        id: 'picking-1',
        order_id: 'order-1',
        warehouse_id: 'warehouse-1',
        status: 'pending',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// 이행 Mock 데이터
export const mockFulfillments = [
    {
        id: 'fulfillment-1',
        order_id: 'order-1',
        status: 'pending',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// 기존 매칭 Mock 데이터 (호환성을 위해 주석 처리)
// export const mockMatchings = [
//     {
//         id: 'matching-1',
//         product_id: 'variant-1',
//         channel_product_id: 'cp-1',
//         status: 'matched',
//         created_at: '2024-01-01T00:00:00Z',
//         updated_at: '2024-01-01T00:00:00Z',
//     },
// ];

// 송장 Mock 데이터
export const mockInvoices = [
    {
        id: 'invoice-1',
        order_id: 'order-1',
        invoice_number: 'INV-2024-001',
        status: 'issued',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// ===== 매칭 관련 목 데이터 (WMS API 스펙 기반) =====

// 기본 재고 정책
const defaultStockPolicy: StockPolicyDto = {
    inventoryManagement: true,
    preStockSellable: true,
    alwaysSellableZeroStock: false,
};

// 매칭 대기 목록 목 데이터
export const mockMatchings: MatchingDto[] = [
    {
        id: 'match-001',
        variantId: 'variant-001',
        status: 'pending',
        priority: 'normal',
        strategy: 'variant',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        orderCount: 1,
        createdAt: '2024-01-15T09:00:00Z',
        updatedAt: '2024-01-15T09:00:00Z',
        order: {
            id: 'order-001',
            salesOrderId: 'SO-2024-001',
            salesChannel: 'medusa',
            channelOrderId: 'CH-001',
            productName: '아몬드영 프리미엄 세트',
            optionName: '용량: 500ml',
            quantity: 2,
            salesAmount: 45000,
            recipient: '김철수',
            orderDate: '2024-01-15T08:30:00Z',
            shippingAddress: '서울시 강남구 테헤란로 123',
            customerName: '김철수',
            customerEmail: 'kim@example.com',
            customerPhone: '010-1234-5678',
        },
        variant: {
            id: 'variant-001',
            name: '아몬드영 프리미엄 세트 - 500ml',
            masterId: 'master-001',
            optionKey: {
                용량: '500ml',
            },
        },
        master: {
            id: 'master-001',
            name: '아몬드영 프리미엄 세트',
        },
    },
    {
        id: 'match-002',
        variantId: 'variant-002',
        status: 'pending',
        priority: 'high',
        strategy: 'variant',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        orderCount: 3,
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
        order: {
            id: 'order-002',
            salesOrderId: 'SO-2024-002',
            salesChannel: 'coupang',
            channelOrderId: 'CP-002',
            productName: '아몬드영 베이직 세트',
            optionName: '색상: 화이트, 용량: 250ml',
            quantity: 1,
            salesAmount: 25000,
            recipient: '이영희',
            orderDate: '2024-01-15T09:15:00Z',
            shippingAddress: '부산시 해운대구 센텀로 456',
            customerName: '이영희',
            customerEmail: 'lee@example.com',
            customerPhone: '010-2345-6789',
        },
        variant: {
            id: 'variant-002',
            name: '아몬드영 베이직 세트 - 화이트 250ml',
            masterId: 'master-002',
            optionKey: {
                색상: '화이트',
                용량: '250ml',
            },
        },
        master: {
            id: 'master-002',
            name: '아몬드영 베이직 세트',
        },
    },
    {
        id: 'match-003',
        variantId: 'variant-003',
        status: 'matched',
        priority: 'normal',
        strategy: 'variant',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        orderCount: 1,
        createdAt: '2024-01-15T11:00:00Z',
        updatedAt: '2024-01-15T11:30:00Z',
        order: {
            id: 'order-003',
            salesOrderId: 'SO-2024-003',
            salesChannel: 'naver',
            channelOrderId: 'NV-003',
            productName: '아몬드영 스페셜 세트',
            optionName: '용량: 750ml',
            quantity: 1,
            salesAmount: 60000,
            recipient: '박민수',
            orderDate: '2024-01-15T10:45:00Z',
            shippingAddress: '대구시 수성구 동대구로 789',
            customerName: '박민수',
            customerEmail: 'park@example.com',
            customerPhone: '010-3456-7890',
        },
        variant: {
            id: 'variant-003',
            name: '아몬드영 스페셜 세트 - 750ml',
            masterId: 'master-003',
            optionKey: {
                용량: '750ml',
            },
        },
        master: {
            id: 'master-003',
            name: '아몬드영 스페셜 세트',
        },
        matchedSkus: [
            {
                skuId: 'sku-003-001',
                quantity: 1,
            },
        ],
    },
    {
        id: 'match-004',
        variantId: 'variant-004',
        status: 'ignored',
        priority: 'normal',
        strategy: 'variant',
        stockPolicy: {
            inventoryManagement: false,
            preStockSellable: false,
            alwaysSellableZeroStock: true,
        },
        isGift: true,
        orderCount: 1,
        createdAt: '2024-01-15T12:00:00Z',
        updatedAt: '2024-01-15T12:15:00Z',
        order: {
            id: 'order-004',
            salesOrderId: 'SO-2024-004',
            salesChannel: 'smartstore',
            channelOrderId: 'SS-004',
            productName: '아몬드영 디지털 상품권',
            optionName: '금액: 10,000원',
            quantity: 1,
            salesAmount: 10000,
            recipient: '정수진',
            orderDate: '2024-01-15T11:30:00Z',
            shippingAddress: '인천시 연수구 컨벤시아대로 101',
            customerName: '정수진',
            customerEmail: 'jung@example.com',
            customerPhone: '010-4567-8901',
        },
        variant: {
            id: 'variant-004',
            name: '아몬드영 디지털 상품권 - 10,000원',
            masterId: 'master-004',
            optionKey: {
                금액: '10,000원',
            },
        },
        master: {
            id: 'master-004',
            name: '아몬드영 디지털 상품권',
        },
    },
    {
        id: 'match-005',
        variantId: 'variant-005',
        status: 'pending',
        priority: 'normal',
        strategy: 'option',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        orderCount: 2,
        createdAt: '2024-01-15T13:00:00Z',
        updatedAt: '2024-01-15T13:00:00Z',
        order: {
            id: 'order-005',
            salesOrderId: 'SO-2024-005',
            salesChannel: 'phone_order',
            channelOrderId: 'PO-005',
            productName: '아몬드영 커스텀 세트',
            optionName: '색상: 블랙, 용량: 500ml, 추가옵션: 개인화',
            quantity: 1,
            salesAmount: 55000,
            recipient: '최지훈',
            orderDate: '2024-01-15T12:30:00Z',
            shippingAddress: '광주시 서구 상무대로 202',
            customerName: '최지훈',
            customerEmail: 'choi@example.com',
            customerPhone: '010-5678-9012',
        },
        variant: {
            id: 'variant-005',
            name: '아몬드영 커스텀 세트 - 블랙 500ml 개인화',
            masterId: 'master-005',
            optionKey: {
                색상: '블랙',
                용량: '500ml',
                추가옵션: '개인화',
            },
        },
        master: {
            id: 'master-005',
            name: '아몬드영 커스텀 세트',
        },
    },
];

// 매칭 목록 응답 목 데이터
export const mockMatchingsResponse: MatchingsResponseDto = {
    data: mockMatchings,
    total: mockMatchings.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
};

// 매칭 대기 상태만 필터링된 응답
export const mockPendingMatchingsResponse: MatchingsResponseDto = {
    data: mockMatchings.filter(m => m.status === 'pending'),
    total: mockMatchings.filter(m => m.status === 'pending').length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
};

// Variant별 매칭 목 데이터
export const mockVariantMatchings: Record<string, VariantMatchingDto> = {
    'variant-001': {
        variantId: 'variant-001',
        status: 'pending',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        createdAt: '2024-01-15T09:00:00Z',
        updatedAt: '2024-01-15T09:00:00Z',
    },
    'variant-002': {
        variantId: 'variant-002',
        status: 'pending',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
    },
    'variant-003': {
        variantId: 'variant-003',
        status: 'matched',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        matchedSkus: [
            {
                skuId: 'sku-003-001',
                quantity: 1,
            },
        ],
        createdAt: '2024-01-15T11:00:00Z',
        updatedAt: '2024-01-15T11:30:00Z',
    },
    'variant-004': {
        variantId: 'variant-004',
        status: 'ignored',
        stockPolicy: {
            inventoryManagement: false,
            preStockSellable: false,
            alwaysSellableZeroStock: true,
        },
        isGift: true,
        createdAt: '2024-01-15T12:00:00Z',
        updatedAt: '2024-01-15T12:15:00Z',
    },
    'variant-005': {
        variantId: 'variant-005',
        status: 'pending',
        stockPolicy: defaultStockPolicy,
        isGift: false,
        createdAt: '2024-01-15T13:00:00Z',
        updatedAt: '2024-01-15T13:00:00Z',
    },
};

// Variant SKU 조회 목 데이터
export const mockVariantSkuLookups: Record<string, VariantSkuLookupResponseDto[]> = {
    'variant-001': [
        {
            skuId: 'sku-001-001',
            quantity: 1,
        },
    ],
    'variant-002': [
        {
            skuId: 'sku-002-001',
            quantity: 1,
        },
    ],
    'variant-003': [
        {
            skuId: 'sku-003-001',
            quantity: 1,
        },
    ],
    'variant-005': [
        {
            skuId: 'sku-005-001',
            quantity: 1,
        },
        {
            skuId: 'sku-005-002',
            quantity: 1,
        },
    ],
};

// 재고 정책 목 데이터
export const mockStockPolicies: Record<string, StockPolicyDto> = {
    'variant-001': defaultStockPolicy,
    'variant-002': defaultStockPolicy,
    'variant-003': defaultStockPolicy,
    'variant-004': {
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: true,
    },
    'variant-005': defaultStockPolicy,
};
