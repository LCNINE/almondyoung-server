// src/lib/types/ui/customers.ts
// Customers 도메인 UI 타입 정의

// UI에서 사용하는 고객 타입
export interface CustomerUI {
    id: string;
    name: string;
    email: string;
    phone?: string;
    status: 'active' | 'inactive' | 'blocked';
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
    totalOrders: number;
    totalSpent: number;
    lastOrderDate?: string;
    createdAt: string;
    // UI 전용 필드들
    isSelected?: boolean;
    statusColor?: string;
    statusIcon?: string;
    tierColor?: string;
    tierIcon?: string;
    formattedTotalSpent?: string;
    formattedLastOrderDate?: string;
    formattedCreatedAt?: string;
    initials?: string;
    profileImage?: string;
}

// 고객 목록 필터 타입
export interface CustomerListFilter {
    status?: ('active' | 'inactive' | 'blocked')[];
    tier?: ('bronze' | 'silver' | 'gold' | 'platinum')[];
    search?: string;
    sortBy?: 'name' | 'email' | 'totalOrders' | 'totalSpent' | 'lastOrderDate' | 'createdAt';
    sortOrder?: 'asc' | 'desc';
}

// 고객 목록 페이지네이션 타입
export interface CustomerListPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// 고객 목록 응답 타입
export interface CustomerListResponse {
    data: CustomerUI[];
    pagination: CustomerListPagination;
    filters: CustomerListFilter;
}

// 고객 상세 정보 타입
export interface CustomerDetailUI {
    customer: CustomerUI;
    profile: CustomerProfileUI;
    orders: CustomerOrderUI[];
    addresses: CustomerAddressUI[];
    preferences: CustomerPreferencesUI;
    activity: CustomerActivityUI[];
}

// 고객 프로필 UI 타입
export interface CustomerProfileUI {
    id: string;
    customerId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: 'male' | 'female' | 'other';
    profileImage?: string;
    bio?: string;
    socialLinks?: {
        facebook?: string;
        twitter?: string;
        instagram?: string;
        linkedin?: string;
    };
    // UI 전용 필드들
    formattedDateOfBirth?: string;
    initials?: string;
    fullName?: string;
}

// 고객 주문 UI 타입
export interface CustomerOrderUI {
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    itemCount: number;
    orderDate: string;
    // UI 전용 필드들
    formattedTotal?: string;
    formattedOrderDate?: string;
    statusColor?: string;
    statusIcon?: string;
}

// 고객 주소 UI 타입
export interface CustomerAddressUI {
    id: string;
    customerId: string;
    type: 'billing' | 'shipping';
    name: string;
    phone?: string;
    address1: string;
    address2?: string;
    city: string;
    postalCode: string;
    country: string;
    isDefault: boolean;
    // UI 전용 필드들
    formattedAddress?: string;
    isSelected?: boolean;
}

// 고객 선호도 UI 타입
export interface CustomerPreferencesUI {
    id: string;
    customerId: string;
    language: string;
    currency: string;
    timezone: string;
    notifications: {
        email: boolean;
        sms: boolean;
        push: boolean;
    };
    marketing: {
        newsletter: boolean;
        promotions: boolean;
        productUpdates: boolean;
    };
    privacy: {
        profilePublic: boolean;
        showEmail: boolean;
        showPhone: boolean;
    };
}

// 고객 활동 UI 타입
export interface CustomerActivityUI {
    id: string;
    customerId: string;
    type: 'login' | 'order' | 'review' | 'wishlist' | 'profile_update';
    description: string;
    timestamp: string;
    metadata?: Record<string, any>;
    // UI 전용 필드들
    formattedTimestamp?: string;
    icon?: string;
    color?: string;
}

// 고객 생성/수정 폼 타입
export interface CustomerFormData {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: 'male' | 'female' | 'other';
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
    status: 'active' | 'inactive' | 'blocked';
    addresses: {
        type: 'billing' | 'shipping';
        name: string;
        phone?: string;
        address1: string;
        address2?: string;
        city: string;
        postalCode: string;
        country: string;
        isDefault: boolean;
    }[];
    preferences: {
        language: string;
        currency: string;
        timezone: string;
        notifications: {
            email: boolean;
            sms: boolean;
            push: boolean;
        };
        marketing: {
            newsletter: boolean;
            promotions: boolean;
            productUpdates: boolean;
        };
    };
}

// 고객 대시보드 타입
export interface CustomerDashboard {
    totalCustomers: number;
    activeCustomers: number;
    newCustomers: number;
    topTiers: CustomerTierStatsUI[];
    recentCustomers: CustomerUI[];
    customerActivity: CustomerActivityUI[];
    topSpenders: TopSpenderUI[];
}

// 고객 등급 통계 UI 타입
export interface CustomerTierStatsUI {
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
    count: number;
    percentage: number;
    formattedPercentage?: string;
    color?: string;
    icon?: string;
}

// 상위 구매자 UI 타입
export interface TopSpenderUI {
    customerId: string;
    customerName: string;
    totalSpent: number;
    orderCount: number;
    lastOrderDate: string;
    formattedTotalSpent?: string;
    formattedLastOrderDate?: string;
    tier?: 'bronze' | 'silver' | 'gold' | 'platinum';
    tierColor?: string;
}

// 고객 세그먼트 타입
export interface CustomerSegment {
    id: string;
    name: string;
    description?: string;
    criteria: {
        tier?: ('bronze' | 'silver' | 'gold' | 'platinum')[];
        totalSpent?: {
            min?: number;
            max?: number;
        };
        orderCount?: {
            min?: number;
            max?: number;
        };
        lastOrderDate?: {
            before?: string;
            after?: string;
        };
    };
    customerCount: number;
    isActive: boolean;
    createdAt: string;
    formattedCreatedAt?: string;
}
