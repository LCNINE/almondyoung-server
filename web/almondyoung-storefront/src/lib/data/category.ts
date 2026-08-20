import "server-only"
import {
  getCategoryByHandle,
  listCategories,
} from "@/lib/api/medusa/categories"
import { cache } from "react"

/**
 * `cache()` 는 인자를 참조(Object.is)로 비교한다. 그래서 배열·객체를 그대로 키로 넘기면
 * 호출부마다 새 리터럴이라 매번 미스가 나고 캐시가 사실상 없는 것과 같아진다.
 * 아래 두 함수가 인자를 문자열로 정규화하거나 아예 받지 않는 건 그 때문이다.
 *
 * fetch 자체는 `CATEGORY_TREE_TAG` 로 1시간 캐싱된다. 관리자가 카테고리를 바꾸면
 * channel-adapter 가 `/api/revalidate` 로 그 태그를 쳐서 즉시 반영한다.
 * 아래 `cache()` 는 그 위에 얹힌 요청 범위 중복 제거다.
 */

const getCategoryByHandleKeyed = cache(async (key: string) =>
  getCategoryByHandle(key.split("/"))
)

/**
 * 같은 요청 안에서 layout·page·generateMetadata 가 같은 카테고리를 조회한다.
 * 왕복을 1회로 유지한다.
 */
export const getCategoryByHandleCached = (segments: string[]) =>
  getCategoryByHandleKeyed(segments.join("/"))

/**
 * 최상위 카테고리 트리(하위 전체 포함). 헤더 메가메뉴·카테고리 사이드바·홈 퀵링크가
 * 한 렌더에서 같은 목록을 필요로 해 왕복이 여러 번 나가던 것을 1회로 합친다.
 */
export const listRootCategoriesCached = cache(async () =>
  listCategories({ parent_category_id: "null" })
)
