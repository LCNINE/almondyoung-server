import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * 이 쇼핑몰에서 «직접» 만들어진 행의 출처값. 나머지 값(`smartstore`·`almondyoung-legacy`…)은
 * 다른 시스템에서 이관된 것이다.
 *
 * 「자체인가」의 판정은 **여기 한 곳**에만 산다. 이 값이 여러 파일에 흩어져 있으면 한 곳만 바뀌어도
 * 조용히 갈리는데, 갈린 쪽이 «세는 쿼리»면 화면 숫자만 틀리고 아무도 못 본다.
 * `source-system.spec.ts` 가 이 파일 밖의 리터럴 사본을 막는다.
 *
 * 🔴 이 축은 「어디서 들어왔는가」이지 「어떤 권한으로 썼는가」가 아니다. 후자는
 * `reviews.review_permission_id` / `review_eligibilities.provider` 가 답한다 — 섞지 말 것.
 */
export const OWN_SOURCE_SYSTEM = 'almondyoung';

/**
 * 관리자가 admin-web 에서 한 건씩 옮겨 적은 리뷰의 출처값(리테일팀). 다른 채널 고객 후기의 이관이라
 * 자체 작성이 아니다 — `isOwnSource` 에 걸리지 않으므로 통계는 이관분으로 세고 베스트·보상 후보에서 빠진다.
 */
export const ADMIN_MANUAL_SOURCE_SYSTEM = 'admin-manual';

/** 자체 작성분만 고르는 술어. */
export function isOwnSource(column: AnyPgColumn): SQL {
  return sql`${column} = ${OWN_SOURCE_SYSTEM}`;
}

/** 이관분만 고르는 술어 — `source_system` 은 NOT NULL 이라 `<>` 로 전수가 갈린다. */
export function isLegacySource(column: AnyPgColumn): SQL {
  return sql`${column} <> ${OWN_SOURCE_SYSTEM}`;
}
