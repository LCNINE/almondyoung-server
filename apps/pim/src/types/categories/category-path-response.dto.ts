export interface CategoryPathInfoDto {
  id: string;
  name: string;
  slug: string;
  level: number;
}

export interface CategoryPathResponseDto {
  categoryId: string;
  path: CategoryPathInfoDto[];
  fullPath: string;
}
