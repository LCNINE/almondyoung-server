export interface CategoryResponseDto {
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
  childCount?: number;
  productCount?: number;
}
