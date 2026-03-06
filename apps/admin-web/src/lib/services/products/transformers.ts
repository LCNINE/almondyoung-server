// src/lib/services/products/transformers.ts
// PIM API 데이터 변환 함수

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

// ===== 기본 변환 함수들 =====

export const transformCategory = (dto: CategoryDto) => dto;
export const transformMaster = (dto: MasterDto) => dto;
export const transformVariant = (dto: VariantDto) => dto;
export const transformChannel = (dto: ChannelDto) => dto;
export const transformChannelProduct = (dto: ChannelProductDto) => dto;

// ===== 상태 변환 함수들 =====

/**
 * 제품 상태를 한국어로 변환
 */
export const getProductStatusLabel = (status: ProductStatus): string => {
    const statusMap: Record<ProductStatus, string> = {
        active: '활성',
        inactive: '비활성',
        draft: '초안',
        archived: '보관됨',
    };
    return statusMap[status] || status;
};

/**
 * 제품 상태 색상 반환
 */
export const getProductStatusColor = (status: ProductStatus): string => {
    const colorMap: Record<ProductStatus, string> = {
        active: 'text-green-600 bg-green-100',
        inactive: 'text-gray-600 bg-gray-100',
        draft: 'text-yellow-600 bg-yellow-100',
        archived: 'text-red-600 bg-red-100',
    };
    return colorMap[status] || 'text-gray-600 bg-gray-100';
};

/**
 * 채널 타입을 한국어로 변환
 */
export const getChannelTypeLabel = (type: ChannelType): string => {
    const typeMap: Record<ChannelType, string> = {
        online: '온라인',
        offline: '오프라인',
        marketplace: '마켓플레이스',
        direct: '직접판매',
    };
    return typeMap[type] || type;
};

/**
 * 채널 타입 색상 반환
 */
export const getChannelTypeColor = (type: ChannelType): string => {
    const colorMap: Record<ChannelType, string> = {
        online: 'text-blue-600 bg-blue-100',
        offline: 'text-purple-600 bg-purple-100',
        marketplace: 'text-orange-600 bg-orange-100',
        direct: 'text-green-600 bg-green-100',
    };
    return colorMap[type] || 'text-gray-600 bg-gray-100';
};

// /**
//  * 가격 전략을 한국어로 변환
//  */
// export const getPricingStrategyLabel = (strategy: PricingStrategy): string => {
//     const strategyMap: Record<PricingStrategy, string> = {
//         fixed_price: '고정가격',
//         dynamic: '동적가격',
//         tiered: '단계별가격',
//         promotional_price: '프로모션가격',
//     };
//     return strategyMap[strategy] || strategy;
// };

// /**
//  * 가격 전략 색상 반환
//  */
// export const getPricingStrategyColor = (strategy: PricingStrategy): string => {
//     const colorMap: Record<PricingStrategy, string> = {
//         fixed_price: 'text-gray-600 bg-gray-100',
//         dynamic: 'text-blue-600 bg-blue-100',
//         tiered: 'text-purple-600 bg-purple-100',
//         promotional: 'text-red-600 bg-red-100',
//     };
//     return colorMap[strategy] || 'text-gray-600 bg-gray-100';
// };

// ===== 매칭 테이블용 변환 함수들 =====

/**
 * 매칭 테이블 상태를 한국어로 변환 (PIM 매칭 테이블 전용)
 * orders의 getMatchingStatusLabel과 구분하기 위해 이름 변경
 */
export const getMatchingTableStatusLabel = (status: string): string => {
    const statusMap: Record<string, string> = {
        matched: '매칭됨',
        unmatched: '매칭 대기',
        no_product: '상품 없음',
    };
    return statusMap[status] || status;
};

/**
 * 매칭 테이블 상태 색상 반환 (PIM 매칭 테이블 전용)
 * orders의 getMatchingStatusColor와 구분하기 위해 이름 변경
 */
export const getMatchingTableStatusColor = (status: string): string => {
    const colorMap: Record<string, string> = {
        matched: 'text-green-600 bg-green-100',
        unmatched: 'text-yellow-600 bg-yellow-100',
        no_product: 'text-red-600 bg-red-100',
    };
    return colorMap[status] || 'text-gray-600 bg-gray-100';
};

/**
 * 매칭 테이블 행을 테이블용 데이터로 변환
 */
export const transformMatchingTableRow = (row: MatchingTableRowDto) => {
    return {
        id: row.id,
        channelName: row.channelProduct.channel?.name || '알 수 없음',
        channelType: row.channelProduct.channel?.type || 'unknown',
        channelProductName: row.channelProduct.name || '상품명 없음',
        variantName: row.variant?.name || '매칭 재고상품 없음',
        matchedSku: row.matchedSku,
        orderInfo: row.orderInfo,
        matchingStatus: row.matchingStatus,
        actions: row.actions,
        // 추가 변환된 필드들
        channelTypeLabel: row.channelProduct.channel?.type ? getChannelTypeLabel(row.channelProduct.channel.type) : '알 수 없음',
        channelTypeColor: row.channelProduct.channel?.type ? getChannelTypeColor(row.channelProduct.channel.type) : 'text-gray-600 bg-gray-100',
        matchingStatusLabel: getMatchingTableStatusLabel(row.matchingStatus),
        matchingStatusColor: getMatchingTableStatusColor(row.matchingStatus),
    };
};

/**
 * 매칭 테이블 데이터를 테이블용 데이터로 변환
 */
export const transformMatchingTableData = (rows: MatchingTableRowDto[]) => {
    return rows.map(transformMatchingTableRow);
};

// ===== 채널별 변환 함수들 =====

/**
 * 채널 ID를 sales-channel-mark 컴포넌트용 타입으로 변환
 */
export const getChannelMarkType = (channelName: string): 'almondyoung' | 'coupang' | 'naver_smartstore' | 'phone_order' | 'other' => {
    const name = channelName.toLowerCase();

    if (name.includes('아몬드영') || name.includes('almondyoung') || name.includes('공식')) {
        return 'almondyoung';
    }
    if (name.includes('쿠팡') || name.includes('coupang')) {
        return 'coupang';
    }
    if (name.includes('네이버') || name.includes('naver') || name.includes('스마트스토어') || name.includes('smartstore')) {
        return 'naver_smartstore';
    }
    if (name.includes('전화') || name.includes('phone') || name.includes('직접')) {
        return 'phone_order';
    }

    return 'other';
};

/**
 * 채널 정보를 sales-channel-mark 컴포넌트용으로 변환
 */
export const transformChannelForMark = (channel: ChannelDto) => {
    return {
        ...channel,
        markType: getChannelMarkType(channel.name),
        typeLabel: getChannelTypeLabel(channel.type),
        typeColor: getChannelTypeColor(channel.type),
    };
};

// ===== 가격 관련 변환 함수들 =====

/**
 * 가격을 포맷된 문자열로 변환
 */
export const formatPrice = (price: number, currency: string = 'KRW'): string => {
    if (currency === 'KRW') {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: 'KRW',
        }).format(price);
    }

    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
    }).format(price);
};

/**
 * 가격 차이를 계산하고 포맷
 */
export const formatPriceDifference = (basePrice: number, currentPrice: number): string => {
    const difference = currentPrice - basePrice;
    const percentage = Math.round((difference / basePrice) * 100);

    if (difference > 0) {
        return `+${formatPrice(difference)} (+${percentage}%)`;
    } else if (difference < 0) {
        return `${formatPrice(difference)} (${percentage}%)`;
    } else {
        return '변동 없음';
    }
};

// ===== 옵션 관련 변환 함수들 =====

/**
 * 옵션 키를 읽기 쉬운 문자열로 변환
 */
export const formatOptionKey = (optionKey: Record<string, string>): string => {
    return Object.entries(optionKey)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
};

/**
 * 옵션 키를 태그 형태로 변환
 */
export const formatOptionKeyAsTags = (optionKey: Record<string, string>) => {
    return Object.entries(optionKey).map(([key, value]) => ({
        key,
        value,
        label: `${key}: ${value}`,
    }));
};

// ===== 검색 및 필터링용 변환 함수들 =====

/**
 * 제품 마스터를 검색용 텍스트로 변환
 */
export const getMasterSearchText = (master: MasterDto): string => {
    const parts = [
        master.name,
        master.description,
        master.brand,
        master.tags?.join(' '),
    ].filter(Boolean);

    return parts.join(' ').toLowerCase();
};

/**
 * 제품 변형을 검색용 텍스트로 변환
 */
export const getVariantSearchText = (variant: VariantDto): string => {
    const parts = [
        variant.name,
        variant.sku,
        formatOptionKey(variant.optionKey || {}),
    ].filter(Boolean);

    return parts.join(' ').toLowerCase();
};

/**
 * 채널 제품을 검색용 텍스트로 변환
 */
export const getChannelProductSearchText = (channelProduct: ChannelProductDto): string => {
    const parts = [
        channelProduct.name,
        channelProduct.description,
        channelProduct.channel?.name,
        channelProduct.master?.name,
    ].filter(Boolean);

    return parts.join(' ').toLowerCase();
};