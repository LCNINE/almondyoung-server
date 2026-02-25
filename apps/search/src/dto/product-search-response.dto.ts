export class ProductSearchItemDto {
  productId: string;
  versionId: string;
  name: string;
  thumbnail: string | null;
  brand: string | null;
  minBasePrice: number | null;
  maxBasePrice: number | null;
  minMembershipPrice: number | null;
  maxMembershipPrice: number | null;
  categoryIds: string[];
  score: number | null;
}

export class ProductSearchPaginationDto {
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

export class ProductSearchResponseDto {
  items: ProductSearchItemDto[];
  pagination: ProductSearchPaginationDto;
}
