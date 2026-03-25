// src/lib/types/ui/products.ts
// 상품 관련 UI 타입 정의 (프론트엔드에서 사용하는 UI 전용 타입)

// 카테고리 UI 타입
export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parentId?: string;
  level: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  children: Category[];
}

// 상품 마스터 UI 타입
export interface Master {
  id: string;
  name: string;
  thumbnail?: string;
  brand?: string; //응답값에 없음
  categoryId: string; //응답값에 없음
  tags: string[]; //응답값에 없음
  isActive: boolean;
  basePrice: number;
  membershipPrice: number;
  wholesalePrice: number; //응답값에 없음
  status: string;
  createdAt: Date;
  updatedAt: Date; //응답값에 없음
  variants: Variant[]; //응답값에 없음
  channel: Channel; //응답값에 없음
  origin: string; //응답값에 없음
}

// 상품 변형 UI 타입
export interface Variant {
  id: string;
  masterId: string;
  sku: string;
  name: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  attributes: Record<string, string>;
  inventory: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 채널 UI 타입
export interface Channel {
  id: string;
  name: string;
  type: string;
  description?: string;
  isActive: boolean;
  settings: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

// 채널 상품 UI 타입
export interface ChannelProductUI {
  id: string;
  channelId: string;
  productId: string;
  channelSku: string;
  channelName: string;
  channelPrice: number;
  channelStatus: string;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
