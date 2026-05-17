import type { CategoryDto } from '@/lib/types/dto/products';

/**
 * 카테고리 상세 응답.
 *
 * 글로벌 `CategoryDto` 가 백엔드 detail 응답의 `productCount` / `totalProductCount`
 * 필드를 누락하고 있어, 본 feature 안에서만 격리해서 쓰는 로컬 타입이다.
 * 글로벌 DTO 정비는 별도 PR.
 */
export type CategoryDetailDto = CategoryDto & {
  productCount: number;
  totalProductCount: number;
};

/**
 * 트리 재배치 펜딩 상태. 드래그 결과를 즉시 서버에 보내지 않고 누적했다가
 * "변경사항 저장" 으로 commit 한다.
 *
 * - `parentMoves`: 부모가 바뀐 노드들의 최종 부모 (`null` = 루트).
 * - `siblingOrders`: 각 부모(`null` = 루트)별 자식 정렬의 최종 결과.
 *
 * commit 시 (1) parentMoves 각각 `/categories/:id/move?newParentId=` 호출,
 * (2) 영향받은 부모(`siblingOrders` 키)별로 `POST /categories/reorder` 호출.
 */
export interface PendingTreeChanges {
  parentMoves: Record<string, string | null>;
  siblingOrders: Record<string, string[]>;
}

export const EMPTY_PENDING: PendingTreeChanges = {
  parentMoves: {},
  siblingOrders: {},
};
