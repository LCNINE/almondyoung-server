// src/lib/types/ui/orders.ts
// Orders 도메인 UI 타입 정의

import type { SalesOrderDto } from '../dto/orders';

// UI에서 사용하는 주문 타입
export interface OrderUI extends Omit<SalesOrderDto, 'customerName'> {
    // UI 전용 필드들
    isSelected?: boolean;
    statusColor?: string;
    statusIcon?: string;
    formattedTotal?: string;
    formattedDate?: string;
    customerName: string | null; // 원본 필드 유지
    channelName?: string;
    itemCount?: number;
    canCancel?: boolean;
    canConfirm?: boolean;
    canModify?: boolean;
}

// 주문 목록 필터 타입
export interface OrderListFilter {
    status?: string[];
    channelId?: string;
    dateRange?: {
        start?: string;
        end?: string;
    };
    customerId?: string;
    search?: string;
    sortBy?: 'orderDate' | 'total' | 'status' | 'customerName';
    sortOrder?: 'asc' | 'desc';
}

// 주문 목록 페이지네이션 타입
export interface OrderListPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// 주문 목록 응답 타입
export interface OrderListResponse {
    data: OrderUI[];
    pagination: OrderListPagination;
    filters: OrderListFilter;
}

// 주문 상세 정보 타입
export interface OrderDetailUI {
    order: OrderUI;
    items: OrderItemUI[];
    customer: CustomerInfoUI;
    shipping: ShippingInfoUI;
    payment: PaymentInfoUI;
    timeline: OrderTimelineUI[];
}

// 주문 아이템 UI 타입
export interface OrderItemUI {
    id: string;
    productName: string;
    variantName?: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    image?: string;
    isSelected?: boolean;
}

// 고객 정보 UI 타입
export interface CustomerInfoUI {
    id: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
}

// 배송 정보 UI 타입
export interface ShippingInfoUI {
    method: string;
    address: {
        name: string;
        phone: string;
        address1: string;
        address2?: string;
        city: string;
        postalCode: string;
        country: string;
    };
    trackingNumber?: string;
    estimatedDelivery?: string;
}

// 결제 정보 UI 타입
export interface PaymentInfoUI {
    method: string;
    status: string;
    amount: number;
    formattedAmount?: string;
    transactionId?: string;
    paidAt?: string;
}

// 주문 타임라인 UI 타입
export interface OrderTimelineUI {
    id: string;
    status: string;
    timestamp: string;
    formattedTimestamp?: string;
    description: string;
    user?: string;
    icon?: string;
    color?: string;
}

// 주문 생성/수정 폼 타입
export interface OrderFormData {
    customerId: string;
    channelId: string;
    items: {
        productId: string;
        variantId?: string;
        quantity: number;
        price: number;
    }[];
    shippingAddress: {
        name: string;
        phone: string;
        address1: string;
        address2?: string;
        city: string;
        postalCode: string;
        country: string;
    };
    paymentMethod: string;
    notes?: string;
}
