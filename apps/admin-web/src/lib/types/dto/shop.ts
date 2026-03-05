import type { UUID } from './common';

// =====  상점 정보 =====
interface Shop {
  id: UUID;
  createdAt: Date;
  updatedAt: Date;
  userId: UUID;
  isOperating: boolean; // 운영 여부
  yearsOperating: number | null; // 운영 기간
  shopType: 'small' | 'solo' | 'large' | null; // 샵 타입
  categories: unknown; // 카테고리
  targetCustomers: unknown; // 타겟 고객
  openDays: unknown; // 운영 요일
}

interface CreateShopInfoDto {
  isOperating: boolean;
  yearsOperating?: number;
  shopType: 'solo' | 'small' | 'large';
  categories: string[];
  customCategory?: string;
  targetCustomers?: string[];
  openDays?: string[];
}

interface UpdateShopInfoDto extends Partial<CreateShopInfoDto> {}

export type { Shop, CreateShopInfoDto, UpdateShopInfoDto };
