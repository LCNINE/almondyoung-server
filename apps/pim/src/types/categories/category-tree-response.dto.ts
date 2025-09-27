export interface CategoryTreeNodeDto {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  level: number;
  path: string;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
  children?: CategoryTreeNodeDto[];
}

export interface CategoryTreeResponseDto {
  categories: CategoryTreeNodeDto[];
  totalCount: number;
  maxDepth: number;
}
