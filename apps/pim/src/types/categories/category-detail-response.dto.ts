import { CategoryResponseDto } from './category-response.dto';

export interface CategoryDetailResponseDto {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  parentId: string | null;
  level: number;
  path: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  parent?: CategoryResponseDto;
  children: CategoryResponseDto[];
  productCount: number;
  totalProductCount: number;
}
