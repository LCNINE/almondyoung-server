/** 재고조회 목록 표시용 최소 필드. 백엔드 SkuResponseDto의 부분집합. */
export interface SkuSearchItem {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
  /** search/advanced 응답에서 계산되는 현재고(전 창고 합산 또는 warehouseId 한정). */
  currentStock: number;
  /** 안전재고. 0이면 부족 판정 제외. */
  safetyStock: number;
}
