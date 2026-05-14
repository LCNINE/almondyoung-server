// 백엔드 응답 진실에 맞춰진 로컬 타입.
// 글로벌 MasterDto/VariantDto 는 백엔드 응답과 어긋나있어 사용하지 않는다.
// 정합 정비는 별도 후속 PR — 그때 이 파일은 글로벌 타입으로 흡수될 수 있다.
//
// 출처:
// - apps/core/.../dto/masters/master-response.dto.ts  (ProductMasterDto)
// - apps/core/.../dto/variants/variant-response.dto.ts (VariantWithPriceDto)

export type ProductMasterDetail = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  status: string | null;
  isWholesaleOnly: boolean | null;
  isMembershipOnly: boolean | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};

export type ProductVariantRow = {
  id: string;
  masterId: string;
  variantName: string | null;
  imageId: string | null;
  displayOrder: number | null;
  status: string | null;
  isDefault: boolean | null;
  createdAt: string;
  updatedAt: string;
  // /variants/masters/:id 응답은 { id, optionGroupId, createdAt } 만 — displayName 없음.
  // 사람이 읽을 옵션 라벨은 detail 엔드포인트에만 있어 현재 목록에서 의미있게 렌더링 불가.
  optionValues: Array<{ id: string; optionGroupId: string }>;
  price?: number;
};

export type ProductVariantsResponse = {
  data: ProductVariantRow[];
  total: number;
  page: number;
  limit: number;
};
