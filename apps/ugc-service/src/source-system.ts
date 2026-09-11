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

/** 자체 작성분만 고르는 술어. */
export function isOwnSource(column: AnyPgColumn): SQL {
  return sql`${column} = ${OWN_SOURCE_SYSTEM}`;
}

/** 이관분만 고르는 술어 — `source_system` 은 NOT NULL 이라 `<>` 로 전수가 갈린다. */
export function isLegacySource(column: AnyPgColumn): SQL {
  return sql`${column} <> ${OWN_SOURCE_SYSTEM}`;
}
