// Medusa(커머스) admin API 요청/응답 DTO

export interface MedusaCustomerListQuery {
  limit?: number;
  offset?: number;
  q?: string;
  order?: string; // Medusa 형식: "-created_at" (desc), "created_at" (asc)
}

export interface MedusaOrderListQuery {
  customer_id?: string;
  limit?: number;
  offset?: number;
  order?: string; // Medusa 형식: "-created_at" (desc), "created_at" (asc)
  // 주문일 범위 필터 (ISO 문자열). Medusa 의 created_at[$gte]/[$lte] 로 전달
  createdAtGte?: string;
  createdAtLte?: string;
}

// 회원 장바구니 (커스텀 admin 엔드포인트 응답 미러)
export interface CustomerCartItem {
  id: string;
  created_at: string;
  quantity: number;
  unit_price: number;
  product_id: string | null;
  // Medusa handle == Core PIM masterId. 관리자 상품 상세 링크용
  master_id: string | null;
  product_title: string | null;
  thumbnail: string | null;
  variant_id: string | null;
  variant_title: string | null;
  variant_sku: string | null;
  // 재고 관리 여부: false=재고 미관리(디지털 상품 등), true=관리, null=variant 조회 실패
  manage_inventory: boolean | null;
  option_stock: number | null;
  total_stock: number | null;
  sold_out: boolean;
}

export interface CustomerCartResponse {
  cart: {
    id: string;
    currency_code: string;
    created_at: string;
    updated_at: string;
  } | null;
  items: CustomerCartItem[];
}
