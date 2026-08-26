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
  // "tpwp" 를 두벌식으로 편 "세제". 있으면 프론트가 교정 안내 줄을 그린다.
  correctedQuery?: string;
  relatedKeywords?: string[];
}
