import { SALES_CHANNEL_SITE_UNIQUE_INDEX } from '../../schema/catalog.schema';

const UNIQUE_VIOLATION = '23505';

/** `.cause` 를 따라 내려갈 최대 깊이. drizzle 의 래핑은 한 겹이지만 여유를 둔다. */
const MAX_CAUSE_DEPTH = 5;

/**
 * `sales_channels.site` 유일 인덱스 위반인가 (#668 항목 1).
 *
 * drizzle-orm 0.44.x 는 driver 에러를 `DrizzleQueryError` 로 감싸므로 실제 postgres.js
 * `PostgresError`(code·constraint_name)는 최상위가 아니라 `.cause` 체인에 있다. 최상위
 * `.code` 만 보면 못 잡고 500 으로 새어나간다 —
 * `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts` 의 `isUniqueViolation` 과
 * 같은 이유·같은 형태다(공용화는 별건).
 *
 * 제약 이름까지 보는 이유: 이 테이블에는 다른 unique 위반도 생길 수 있는데, 그걸 "site 중복"
 * 이라고 안내하면 운영자가 엉뚱한 곳을 고친다.
 */
export function isSalesChannelSiteConflict(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    const row = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (row.code === UNIQUE_VIOLATION && row.constraint_name === SALES_CHANNEL_SITE_UNIQUE_INDEX) {
      return true;
    }
    current = row.cause;
  }

  return false;
}
