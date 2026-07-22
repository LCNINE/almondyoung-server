/** 재고조회 목록 표시용 최소 필드. 백엔드 SkuResponseDto의 부분집합. */
export interface SkuSearchItem {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
}
