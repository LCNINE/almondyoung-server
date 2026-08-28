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
  // 원본 검색어가 키워드 절로 실제 찾은 건수. 벡터가 채운 몫도, 교정어로 찾은 몫도 빼고 센다 —
  // 0 건 키워드 리포트(소싱 후보)가 "우리가 이 말로 못 찾는 검색어"를 놓치지 않게 하는 값이다.
  keywordMatchCount?: number;
}
