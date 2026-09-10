import { type InferSelectModel } from 'drizzle-orm';
import { reviewEligibilities } from '../db/schema';

export type ReviewEligibilityEntity = InferSelectModel<typeof reviewEligibilities>;

/**
 * 리뷰를 쓸 권한을 «어떻게 얻었는가». 표의 `provider` 컬럼이 이 값을 들고 있고,
 * 리뷰 모듈은 이 종류를 모른다 — 권한 행을 참조하기만 한다.
 *
 * `order` — 구매한 주문 라인에서 나온 권한.
 * `admin` — 운영자가 직접 준 권한. 주문 라인이 없고, 보상 대상이 아니다.
 */
export type ReviewPermissionProvider = 'order' | 'admin';

/** 회수 배관이 자격에서 필요로 하는 최소 필드. 전체 행을 들고 다니지 않는다. */
export interface OrderEligibilityRow {
  id: string;
  userId: string;
  /** 운영자가 준 권한에는 주문 라인이 없다. */
  orderLineId: string | null;
  consumedByReviewId: string | null;
}

/** 자격을 회수한 결과 — 소비된 자격이면 그 리뷰 id 가 따라 나온다. */
export interface RevokedEligibilityRow {
  id: string;
  consumedByReviewId: string | null;
}
