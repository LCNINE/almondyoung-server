// src/lib/mock/data/products.ts
// PIM API 목 데이터

import type {
    CategoryDto,
    MasterDto,
    VariantDto,
    ChannelDto,
    ChannelProductDto,
    MatchingTableRowDto,
    ProductStatus,
    ChannelType,
    PricingStrategy,
} from '@/lib/types/dto/products';

// ===== 카테고리 목 데이터 =====

export const mockCategories: CategoryDto[] = [
    {
        id: 'cat-001',
        name: '뷰티',
        description: '뷰티 관련 제품',
        parentId: null,
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        children: [
            {
                id: 'cat-002',
                name: '메이크업',
                description: '메이크업 제품',
                parentId: 'cat-001',
                isActive: true,
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
            },
            {
                id: 'cat-003',
                name: '스킨케어',
                description: '스킨케어 제품',
                parentId: 'cat-001',
                isActive: true,
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
            },
        ],
    },
    {
        id: 'cat-004',
        name: '헬스케어',
        description: '헬스케어 관련 제품',
        parentId: null,
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// ===== 제품 마스터 목 데이터 =====

export const mockMasters: MasterDto[] = [
    {
        id: 'master-001',
        name: '아몬드영 프리미엄 세트',
        description: '프리미엄 뷰티 세트',
        basePrice: 45000,
        pricingStrategy: 'fixed' as PricingStrategy,
        brand: '아몬드영',
        categoryId: 'cat-001',
        category: mockCategories[0],
        status: 'active' as ProductStatus,
        images: ['/images/almond-premium-set.jpg'],
        specifications: {
            weight: '500g',
            ingredients: ['아몬드 오일', '비타민 E'],
        },
        tags: ['프리미엄', '세트', '뷰티'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'master-002',
        name: '아몬드영 베이직 세트',
        description: '베이직 뷰티 세트',
        basePrice: 25000,
        pricingStrategy: 'fixed' as PricingStrategy,
        brand: '아몬드영',
        categoryId: 'cat-001',
        category: mockCategories[0],
        status: 'active' as ProductStatus,
        images: ['/images/almond-basic-set.jpg'],
        specifications: {
            weight: '250g',
            ingredients: ['아몬드 오일'],
        },
        tags: ['베이직', '세트', '뷰티'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'master-003',
        name: '일회용 립브러쉬 50개',
        description: '일회용 립브러쉬',
        basePrice: 15000,
        pricingStrategy: 'fixed' as PricingStrategy,
        brand: '아몬드영',
        categoryId: 'cat-002',
        category: mockCategories[0].children?.[0],
        status: 'active' as ProductStatus,
        images: ['/images/disposable-lip-brush.jpg'],
        specifications: {
            material: '실리콘',
            quantity: 50,
        },
        tags: ['일회용', '립브러쉬', '메이크업'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'master-005',
        name: '아몬드영 커스텀 세트',
        description: '커스텀 뷰티 세트',
        basePrice: 55000,
        pricingStrategy: 'fixed' as PricingStrategy,
        brand: '아몬드영',
        categoryId: 'cat-001',
        category: mockCategories[0],
        status: 'active' as ProductStatus,
        images: ['/images/almond-custom-set.jpg'],
        specifications: {
            weight: '600g',
            ingredients: ['아몬드 오일', '비타민 E', '개인화 옵션'],
        },
        tags: ['커스텀', '세트', '뷰티', '개인화'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// ===== 제품 변형 목 데이터 =====

export const mockVariants: VariantDto[] = [
    {
        id: 'variant-001',
        masterId: 'master-001',
        master: mockMasters[0],
        name: '아몬드영 프리미엄 세트 - 500ml',
        sku: 'ALM-PREM-500',
        optionKey: {
            용량: '500ml',
        },
        price: 45000,
        calculatedPrice: 45000,
        status: 'active' as ProductStatus,
        images: ['/images/almond-premium-set-500ml.jpg'],
        specifications: {
            용량: '500ml',
            색상: '투명',
        },
        inventory: {
            trackQuantity: true,
            allowBackorder: false,
            minOrderQuantity: 1,
            maxOrderQuantity: 10,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'variant-002',
        masterId: 'master-002',
        master: mockMasters[1],
        name: '아몬드영 베이직 세트 - 화이트 250ml',
        sku: 'ALM-BASIC-WHITE-250',
        optionKey: {
            색상: '화이트',
            용량: '250ml',
        },
        price: 25000,
        calculatedPrice: 25000,
        status: 'active' as ProductStatus,
        images: ['/images/almond-basic-set-white-250ml.jpg'],
        specifications: {
            색상: '화이트',
            용량: '250ml',
        },
        inventory: {
            trackQuantity: true,
            allowBackorder: false,
            minOrderQuantity: 1,
            maxOrderQuantity: 5,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'variant-003',
        masterId: 'master-003',
        master: mockMasters[2],
        name: '일회용 립브러쉬 50개 (옵션: 스카이)',
        sku: 'LIP-BRUSH-SKY-50',
        optionKey: {
            색상: '스카이',
        },
        price: 15000,
        calculatedPrice: 15000,
        status: 'active' as ProductStatus,
        images: ['/images/disposable-lip-brush-sky.jpg'],
        specifications: {
            색상: '스카이',
            수량: 50,
        },
        inventory: {
            trackQuantity: true,
            allowBackorder: true,
            minOrderQuantity: 1,
            maxOrderQuantity: 20,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'variant-005',
        masterId: 'master-005',
        master: mockMasters[3], // master-005
        name: '아몬드영 커스텀 세트 - 블랙 500ml 개인화',
        sku: 'ALM-CUSTOM-BLACK-500-PERSONAL',
        optionKey: {
            색상: '블랙',
            용량: '500ml',
            추가옵션: '개인화',
        },
        price: 55000,
        calculatedPrice: 55000,
        status: 'active' as ProductStatus,
        images: ['/images/almond-custom-set-black-500ml-personal.jpg'],
        specifications: {
            색상: '블랙',
            용량: '500ml',
            추가옵션: '개인화',
        },
        inventory: {
            trackQuantity: true,
            allowBackorder: false,
            minOrderQuantity: 1,
            maxOrderQuantity: 3,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// ===== 판매 채널 목 데이터 =====

export const mockChannels: ChannelDto[] = [
    {
        id: 'channel-001',
        type: 'online' as ChannelType,
        name: '아몬드영 공식몰',
        description: '아몬드영 공식 온라인 쇼핑몰',
        config: {
            domain: 'almondyoung.com',
            currency: 'KRW',
        },
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'channel-002',
        type: 'marketplace' as ChannelType,
        name: '쿠팡',
        description: '쿠팡 마켓플레이스',
        config: {
            sellerId: 'almondyoung',
            currency: 'KRW',
        },
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'channel-003',
        type: 'marketplace' as ChannelType,
        name: '네이버 스마트스토어',
        description: '네이버 스마트스토어',
        config: {
            storeId: 'almondyoung',
            currency: 'KRW',
        },
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'channel-004',
        type: 'direct' as ChannelType,
        name: '전화주문',
        description: '전화를 통한 직접 주문',
        config: {
            phoneNumber: '1588-0000',
            currency: 'KRW',
        },
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// ===== 채널별 제품 목 데이터 =====

export const mockChannelProducts: ChannelProductDto[] = [
    {
        id: 'cp-001',
        masterId: 'master-001',
        master: mockMasters[0],
        channelId: 'channel-001',
        channel: mockChannels[0],
        name: '아몬드영 프리미엄 세트',
        description: '프리미엄 뷰티 세트 - 공식몰 전용',
        price: 45000,
        isActive: true,
        channelSpecificData: {
            displayName: '프리미엄 세트',
            tags: ['인기', '추천'],
        },
        images: ['/images/almond-premium-set-official.jpg'],
        specifications: {
            배송: '무료배송',
            혜택: '사은품 증정',
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'cp-002',
        masterId: 'master-002',
        master: mockMasters[1],
        channelId: 'channel-002',
        channel: mockChannels[1],
        name: '아몬드영 베이직 세트',
        description: '베이직 뷰티 세트 - 쿠팡 전용',
        price: 25000,
        isActive: true,
        channelSpecificData: {
            displayName: '베이직 세트',
            tags: ['쿠팡 추천'],
        },
        images: ['/images/almond-basic-set-coupang.jpg'],
        specifications: {
            배송: '로켓배송',
            혜택: '쿠팡카드 할인',
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'cp-003',
        masterId: 'master-003',
        master: mockMasters[2],
        channelId: 'channel-003',
        channel: mockChannels[2],
        name: '일회용 립브러쉬 50개 (옵션: 스카이)',
        description: '일회용 립브러쉬 - 네이버 스마트스토어',
        price: 15000,
        isActive: true,
        channelSpecificData: {
            displayName: '립브러쉬 스카이',
            tags: ['네이버 추천'],
        },
        images: ['/images/disposable-lip-brush-naver.jpg'],
        specifications: {
            배송: '네이버페이 배송',
            혜택: '네이버페이 적립',
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
];

// ===== 매칭 테이블용 목 데이터 =====

export const mockMatchingTableRows: MatchingTableRowDto[] = [
    {
        id: 'match-row-001',
        channelProduct: mockChannelProducts[0],
        variant: mockVariants[0],
        matchedSku: {
            skuId: 'sku-001-001',
            quantity: 2,
            barcode: '1235409501',
        },
        orderInfo: {
            quantity: 2,
            salesAmount: 90000,
            recipient: '김철수',
            orderDate: '2024-01-15T08:30:00Z',
        },
        matchingStatus: 'matched',
        actions: {
            canMatch: false,
            canRematch: true,
            canEdit: true,
            canDelete: true,
            canCreate: false,
        },
    },
    {
        id: 'match-row-002',
        channelProduct: mockChannelProducts[1],
        variant: mockVariants[1],
        matchedSku: {
            skuId: 'sku-002-001',
            quantity: 1,
            barcode: '1235409502',
        },
        orderInfo: {
            quantity: 1,
            salesAmount: 25000,
            recipient: '이영희',
            orderDate: '2024-01-15T09:15:00Z',
        },
        matchingStatus: 'matched',
        actions: {
            canMatch: false,
            canRematch: true,
            canEdit: true,
            canDelete: true,
            canCreate: false,
        },
    },
    {
        id: 'match-row-003',
        channelProduct: mockChannelProducts[2],
        variant: mockVariants[2],
        matchedSku: {
            skuId: 'sku-003-001',
            quantity: 4,
            barcode: '1235409503',
        },
        orderInfo: {
            quantity: 4,
            salesAmount: 60000,
            recipient: '박민수',
            orderDate: '2024-01-15T10:45:00Z',
        },
        matchingStatus: 'matched',
        actions: {
            canMatch: false,
            canRematch: true,
            canEdit: true,
            canDelete: true,
            canCreate: false,
        },
    },
    {
        id: 'match-row-004',
        channelProduct: {
            id: 'cp-004',
            masterId: 'master-004',
            channelId: 'channel-004',
            channel: mockChannels[3],
            name: '매칭 재고상품 없음',
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
        },
        matchingStatus: 'unmatched',
        actions: {
            canMatch: true,
            canRematch: false,
            canEdit: false,
            canDelete: false,
            canCreate: false,
        },
    },
    {
        id: 'match-row-005',
        channelProduct: {
            id: 'cp-005',
            masterId: 'master-005',
            channelId: 'channel-001',
            channel: mockChannels[0],
            name: '상품 없음',
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
        },
        matchingStatus: 'no_product',
        actions: {
            canMatch: false,
            canRematch: false,
            canEdit: false,
            canDelete: false,
            canCreate: true,
        },
    },
];

// ===== 응답용 목 데이터 =====

export const mockCategoryTreeResponse = {
    categories: mockCategories,
    totalCount: mockCategories.length,
    maxDepth: 2,
};

export const mockMastersResponse = {
    data: mockMasters,
    total: mockMasters.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
};

export const mockVariantsResponse = {
    data: mockVariants,
    total: mockVariants.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
};

export const mockChannelsResponse = {
    data: mockChannels,
    total: mockChannels.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
};

export const mockChannelProductsResponse = {
    data: mockChannelProducts,
    total: mockChannelProducts.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
};

export const mockMatchingTableResponse = {
    data: mockMatchingTableRows,
    total: mockMatchingTableRows.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
};