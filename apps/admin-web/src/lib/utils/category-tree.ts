/**
 * 카테고리 관리 페이지와 상품 카테고리 선택기가 공유하는 트리 로직.
 *
 * admin-web 은 `.tsx` 를 테스트할 수 없으므로(jest transform 이 `.ts` 만 받는다)
 * 판정 가능한 규칙은 전부 이 파일의 순수 함수로 내려온다.
 */

/** 두 소비자가 모두 만족하는 최소 노드 형태. 어느 쪽도 자기 타입을 바꾸지 않는다. */
export type CategoryTreeNodeLike = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  isActive: boolean;
  /** 멤버십 전용 카테고리 여부. 관리 페이지는 필수, DTO 는 선택이라 optional 로 받는다. */
  isVisibleToMembersOnly?: boolean;
  children?: CategoryTreeNodeLike[];
};

/** 소문자화 + 공백 전부 제거. 비교는 항상 이 형태로 한다. */
export function normalizeSearchTerm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/**
 * 마지막 토큰은 "찾는 대상"(이름·slug·설명), 앞 토큰들은 "위치 한정"(경로)이다.
 *
 * `pathSegments` 는 조상 + **자기 이름**이다. 자기 이름을 빼면 `스킨 케어` 가
 * 불매치가 된다 — `스킨` 이 조상 `화장품` 에는 없기 때문.
 *
 * 마지막 토큰을 이름에 묶어두는 것이 폭발 방어선이다. 경로 전체를 그냥
 * 부분일치시키면 `화장품` 하나로 그 아래 수백 개가 전부 매치된다.
 */
export function matchesCategory(
  node: CategoryTreeNodeLike,
  pathSegments: string[],
  query: string
): boolean {
  const tokens = query
    .split(/\s+/)
    .map(normalizeSearchTerm)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return false;

  const target = tokens[tokens.length - 1];
  const locators = tokens.slice(0, -1);

  const haystacks = [node.name, node.slug, node.description]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(normalizeSearchTerm);
  if (!haystacks.some((haystack) => haystack.includes(target))) return false;

  const path = normalizeSearchTerm(pathSegments.join('/'));
  return locators.every((locator) => path.includes(locator));
}
