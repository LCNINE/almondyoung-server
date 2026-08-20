# 상품 카테고리 선택기 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품 카테고리 선택 모달을 평탄한 목록에서 접히는 트리로 바꾸고, 검색·비활성 필터·선택 해제·대표 지정·키보드 조작을 갖춘 전체화면 시트로 만든다.

**Architecture:** 판정 가능한 로직은 전부 `.ts` 순수 함수로 뽑아 `src/lib/utils/category-tree.ts`(공용)와 `category-selection-model.ts`(선택기 전용)에 두고 스펙으로 검증한다. 뷰(`.tsx`)는 admin-web 환경상 테스트가 불가능하므로 얇게 유지하고 순수 함수를 호출만 한다. 카테고리 관리 페이지의 `use-tree-expansion` 훅은 인터페이스를 유지한 채 내부만 같은 공용 함수로 교체한다.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind, shadcn/ui(Radix), Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-08-21-category-selection-modal-design.md`

## Global Constraints

- **범위:** `apps/admin-web` 전용. 백엔드 변경 0건, 마이그레이션 0건, 배포 순서 제약 없음
- **모든 경로는 `apps/admin-web/` 기준**이다. 명령은 저장소 루트에서 실행한다
- **`.tsx` 는 테스트할 수 없다.** `test:admin-web` 의 transform 이 `^.+\.(t|j)s$` 라 `.tsx` 는 아예 밖이다. 컴포넌트 스펙을 작성하지 말 것 — 조용히 실행조차 되지 않는다
- **`npx jest` 는 OOM 이 난다.** 전체 실행은 반드시 `npx jest --maxWorkers=2`
- **워크트리에서 작업할 경우** 디렉터리 이름의 `+` 가 jest 의 정규식 무시 패턴을 오염시킨다. `npm run test:admin-web -- <패턴>` 형태의 부분일치 패턴을 쓸 것
- **검증 게이트는 둘 다 0 이 기준선이다:** `npm run type-check`, `npx jest --maxWorkers=2`
- **커밋 메시지는 한국어 + conventional commit.** 각 커밋 끝에 실행 세션의 `Claude-Session:` 푸터를 붙인다 (아래 예시에는 생략돼 있다)
- **`any` / `as` 캐스팅 금지** (CLAUDE.md 타입 안전 규칙)
- 이슈: #686

---

## 파일 구조

| 파일 | 책임 | 테스트 |
|---|---|---|
| `src/lib/utils/category-tree.ts` | **신규.** 트리 순회·검색 매칭·가지치기·보이는순서·키보드 규칙. 관리 페이지와 선택기가 공유 | ✅ `category-tree.spec.ts` |
| `src/features/mall/categories/hooks/use-tree-expansion.ts` | **수정.** 인터페이스 유지, 내부를 공용 함수로 교체 | 간접 |
| `…/products-detail/components/general/category-selection-model.ts` | **신규.** 선택 토글·대표 승계·경로 라벨·가시성 술어 | ✅ 동명 spec |
| `…/general/category-selection-tree-node.tsx` | **신규.** 재귀 행 렌더 | ❌ 불가 |
| `…/general/category-selection-modal.tsx` | **재작성.** 다이얼로그 껍데기·상태·배치 | ❌ 불가 |
| `…/general/index.tsx` | **수정.** 모달에 트리를 넘기도록 배선 | ❌ 불가 |
| `src/components/common/category-tree-select.tsx` | **삭제.** dead code | — |

---

## Task 1: 공용 모듈 — 검색 매칭

**Files:**
- Create: `apps/admin-web/src/lib/utils/category-tree.ts`
- Test: `apps/admin-web/src/lib/utils/category-tree.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces:
  - `type CategoryTreeNodeLike = { id: string; name: string; slug?: string; description?: string; isActive: boolean; isVisibleToMembersOnly?: boolean; children?: CategoryTreeNodeLike[] }`
  - `normalizeSearchTerm(value: string): string`
  - `matchesCategory(node: CategoryTreeNodeLike, pathSegments: string[], query: string): boolean`

**배경:** 매칭 규칙은 스펙 §4. 검색어를 공백으로 쪼개 **마지막 토큰은 "찾는 대상", 앞 토큰들은 "위치 한정"** 으로 읽는다. `pathSegments` 는 **조상 + 자기 이름**이다 — 자기 이름을 빼면 `스킨 케어` 가 불매치가 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin-web/src/lib/utils/category-tree.spec.ts`:

```ts
import { matchesCategory, normalizeSearchTerm } from './category-tree';
import type { CategoryTreeNodeLike } from './category-tree';

const node = (
  id: string,
  name: string,
  extra: Partial<CategoryTreeNodeLike> = {}
): CategoryTreeNodeLike => ({ id, name, isActive: true, ...extra });

describe('normalizeSearchTerm', () => {
  it('소문자화하고 공백을 전부 제거한다', () => {
    expect(normalizeSearchTerm('  Body Care ')).toBe('bodycare');
    expect(normalizeSearchTerm('스킨 케어')).toBe('스킨케어');
  });
});

describe('matchesCategory', () => {
  const toner = node('t', '토너', { slug: 'toner', description: '수분 공급' });

  it('단일 토큰은 이름에 부분일치한다', () => {
    expect(matchesCategory(toner, ['화장품', '스킨케어', '토너'], '토너')).toBe(true);
  });

  it('단일 토큰은 slug 와 설명에도 매치한다', () => {
    expect(matchesCategory(toner, ['화장품', '토너'], 'TON')).toBe(true);
    expect(matchesCategory(toner, ['화장품', '토너'], '수분')).toBe(true);
  });

  it('경로에만 있는 말은 단일 토큰으로는 매치하지 않는다', () => {
    expect(matchesCategory(toner, ['화장품', '스킨케어', '토너'], '화장품')).toBe(false);
  });

  it('공백이 들어간 이름을 공백 무시로 찾는다', () => {
    const skincare = node('s', '스킨케어');
    expect(matchesCategory(skincare, ['화장품', '스킨케어'], '스킨 케어')).toBe(true);
  });

  it('앞 토큰은 조상 경로에서 위치를 한정한다', () => {
    const cream = node('c', '크림');
    expect(matchesCategory(cream, ['화장품', '바디케어', '크림'], '바디 크림')).toBe(true);
    expect(matchesCategory(cream, ['화장품', '스킨케어', '크림'], '바디 크림')).toBe(false);
  });

  it('토큰 순서는 넓은 것에서 좁은 것으로만 통한다', () => {
    const cream = node('c', '크림');
    expect(matchesCategory(cream, ['화장품', '바디케어', '크림'], '크림 바디')).toBe(false);
  });

  it('빈 검색어는 매치가 아니다', () => {
    expect(matchesCategory(toner, ['토너'], '   ')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: FAIL — `Cannot find module './category-tree'`

- [ ] **Step 3: 최소 구현을 쓴다**

`apps/admin-web/src/lib/utils/category-tree.ts`:

```ts
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/utils/category-tree.ts apps/admin-web/src/lib/utils/category-tree.spec.ts
git commit -m "feat(admin-web): 카테고리 검색 매칭 규칙을 순수 함수로 뽑는다 (#686)"
```

---

## Task 2: 공용 모듈 — 순회와 펼침 수집

**Files:**
- Modify: `apps/admin-web/src/lib/utils/category-tree.ts`
- Test: `apps/admin-web/src/lib/utils/category-tree.spec.ts`

**Interfaces:**
- Consumes: `CategoryTreeNodeLike`, `matchesCategory`, `normalizeSearchTerm` (Task 1)
- Produces:
  - `orderedCategoryIds(tree: CategoryTreeNodeLike[]): string[]` — 전위 순회
  - `collectAllIds(tree: CategoryTreeNodeLike[]): Set<string>`
  - `collectSearchExpansion(tree, query): { matchedIds: Set<string>; expandedIds: Set<string> }`
  - `collectAncestorIds(tree, targetIds: Iterable<string>): Set<string>`

**배경:** `expandedIds` 는 매치 노드의 **조상만** 담는다 (매치 노드 자신은 담지 않는다 — 자기를 펼칠 이유가 없다). `collectAncestorIds` 는 모달이 열릴 때 "이미 선택된 카테고리의 조상"을 초기 펼침값으로 쓰기 위한 것이다 (스펙 §6).

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`category-tree.spec.ts` 끝에 추가:

```ts
import {
  collectAllIds,
  collectAncestorIds,
  collectSearchExpansion,
  orderedCategoryIds,
} from './category-tree';

const tree: CategoryTreeNodeLike[] = [
  node('cosmetics', '화장품', {
    children: [
      node('skincare', '스킨케어', {
        children: [node('toner', '토너'), node('cream-face', '크림')],
      }),
      node('bodycare', '바디케어', { children: [node('cream-body', '크림')] }),
    ],
  }),
  node('food', '식품'),
];

describe('orderedCategoryIds', () => {
  it('전위 순회 순서로 id 를 낸다', () => {
    expect(orderedCategoryIds(tree)).toEqual([
      'cosmetics',
      'skincare',
      'toner',
      'cream-face',
      'bodycare',
      'cream-body',
      'food',
    ]);
  });
});

describe('collectAllIds', () => {
  it('모든 노드 id 를 담는다', () => {
    expect(collectAllIds(tree).size).toBe(7);
  });
});

describe('collectSearchExpansion', () => {
  it('매치 노드와 그 조상들을 나눠 낸다', () => {
    const { matchedIds, expandedIds } = collectSearchExpansion(tree, '토너');
    expect([...matchedIds]).toEqual(['toner']);
    expect([...expandedIds].sort()).toEqual(['cosmetics', 'skincare']);
  });

  it('매치 노드 자신은 펼침 대상이 아니다', () => {
    const { expandedIds } = collectSearchExpansion(tree, '토너');
    expect(expandedIds.has('toner')).toBe(false);
  });

  it('위치 한정 토큰이 같은 이름을 갈라낸다', () => {
    const { matchedIds } = collectSearchExpansion(tree, '바디 크림');
    expect([...matchedIds]).toEqual(['cream-body']);
  });

  it('빈 검색어는 아무것도 내지 않는다', () => {
    const { matchedIds, expandedIds } = collectSearchExpansion(tree, '  ');
    expect(matchedIds.size).toBe(0);
    expect(expandedIds.size).toBe(0);
  });
});

describe('collectAncestorIds', () => {
  it('대상들의 조상만 모은다 (자신은 제외)', () => {
    const result = collectAncestorIds(tree, ['toner', 'cream-body']);
    expect([...result].sort()).toEqual(['bodycare', 'cosmetics', 'skincare']);
  });

  it('없는 id 는 조용히 무시한다', () => {
    expect(collectAncestorIds(tree, ['nope']).size).toBe(0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: FAIL — `orderedCategoryIds is not a function`

- [ ] **Step 3: 구현을 추가한다**

`category-tree.ts` 끝에 추가:

```ts
/** 전위 순회(pre-order DFS) 순서의 id 목록. 선택 정렬의 기준 순서다. */
export function orderedCategoryIds(tree: CategoryTreeNodeLike[]): string[] {
  const out: string[] = [];
  const walk = (nodes: CategoryTreeNodeLike[]): void => {
    for (const node of nodes) {
      out.push(node.id);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

export function collectAllIds(tree: CategoryTreeNodeLike[]): Set<string> {
  return new Set(orderedCategoryIds(tree));
}

/**
 * 검색 매치 노드와, 그 노드를 화면에 드러내기 위해 펼쳐야 할 조상들.
 *
 * `expandedIds` 에 매치 노드 자신은 넣지 않는다 — 자기를 펼칠 이유가 없다.
 */
export function collectSearchExpansion(
  tree: CategoryTreeNodeLike[],
  query: string
): { matchedIds: Set<string>; expandedIds: Set<string> } {
  const matchedIds = new Set<string>();
  const expandedIds = new Set<string>();
  if (normalizeSearchTerm(query).length === 0) return { matchedIds, expandedIds };

  const walk = (
    nodes: CategoryTreeNodeLike[],
    pathSegments: string[],
    ancestorIds: string[]
  ): void => {
    for (const node of nodes) {
      const nextPath = [...pathSegments, node.name];
      if (matchesCategory(node, nextPath, query)) {
        matchedIds.add(node.id);
        for (const ancestorId of ancestorIds) expandedIds.add(ancestorId);
      }
      if (node.children?.length) {
        walk(node.children, nextPath, [...ancestorIds, node.id]);
      }
    }
  };
  walk(tree, [], []);
  return { matchedIds, expandedIds };
}

/**
 * 주어진 노드들의 조상 id 집합 (대상 자신은 제외).
 * 모달이 열릴 때 "이미 선택된 카테고리"를 드러내는 초기 펼침값으로 쓴다.
 */
export function collectAncestorIds(
  tree: CategoryTreeNodeLike[],
  targetIds: Iterable<string>
): Set<string> {
  const targets = new Set(targetIds);
  const out = new Set<string>();
  if (targets.size === 0) return out;

  const walk = (nodes: CategoryTreeNodeLike[], ancestorIds: string[]): void => {
    for (const node of nodes) {
      if (targets.has(node.id)) {
        for (const ancestorId of ancestorIds) out.add(ancestorId);
      }
      if (node.children?.length) walk(node.children, [...ancestorIds, node.id]);
    }
  };
  walk(tree, []);
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: PASS (16 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/utils/category-tree.ts apps/admin-web/src/lib/utils/category-tree.spec.ts
git commit -m "feat(admin-web): 카테고리 트리 순회와 펼침 수집 함수를 더한다 (#686)"
```

---

## Task 3: 공용 모듈 — 가지치기

**Files:**
- Modify: `apps/admin-web/src/lib/utils/category-tree.ts`
- Test: `apps/admin-web/src/lib/utils/category-tree.spec.ts`

**Interfaces:**
- Consumes: `CategoryTreeNodeLike` (Task 1)
- Produces:
  - `type PrunedNode = { node: CategoryTreeNodeLike; pathSegments: string[]; matchedSelf: boolean; children: PrunedNode[] }`
  - `pruneTree(tree: CategoryTreeNodeLike[], predicate: (node: CategoryTreeNodeLike, pathSegments: string[]) => boolean): PrunedNode[]`

**제네릭을 쓰지 않는 이유:** `T extends CategoryTreeNodeLike` 로 두면 `node.children`
이 `CategoryTreeNodeLike[]` 라 재귀 호출에 `as T[]` 캐스팅이 필요해진다. 이 저장소는
`as` 캐스팅을 금지한다. 두 소비자 모두 기반 타입의 필드만 읽으므로 제네릭이 필요 없다.

**배경:** 스펙 §5. **노드가 보인다 = 본인이 술어를 통과 OR 자손 중 통과하는 게 있다.** 이 규칙 하나가 검색과 비활성을 둘 다 처리한다. `matchedSelf: false` 는 "자손 때문에 남은 구조 유지용 노드"라는 뜻이고, 뷰는 이런 노드를 흐리게 그리고 체크박스를 잠근다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`category-tree.spec.ts` 에 추가 (`tree` 상수는 Task 2 것을 재사용):

```ts
import { pruneTree } from './category-tree';

describe('pruneTree', () => {
  it('술어를 통과한 노드만 남긴다', () => {
    const result = pruneTree(tree, (node) => node.id === 'food');
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe('food');
  });

  it('자손이 통과하면 부모도 남되 matchedSelf 가 false 다', () => {
    const result = pruneTree(tree, (node) => node.id === 'toner');
    expect(result[0].node.id).toBe('cosmetics');
    expect(result[0].matchedSelf).toBe(false);
    expect(result[0].children[0].node.id).toBe('skincare');
    expect(result[0].children[0].matchedSelf).toBe(false);
    expect(result[0].children[0].children[0].node.id).toBe('toner');
    expect(result[0].children[0].children[0].matchedSelf).toBe(true);
  });

  it('본인도 자손도 통과 못 하면 사라진다', () => {
    const result = pruneTree(tree, (node) => node.id === 'toner');
    expect(result[0].children.map((entry) => entry.node.id)).toEqual(['skincare']);
  });

  it('pathSegments 는 자기 이름까지 포함한다', () => {
    const result = pruneTree(tree, (node) => node.id === 'toner');
    expect(result[0].children[0].children[0].pathSegments).toEqual([
      '화장품',
      '스킨케어',
      '토너',
    ]);
  });

  it('비활성 부모 아래 활성 자식은 살아남는다', () => {
    const inactiveParent: CategoryTreeNodeLike[] = [
      node('p', '화장품', {
        isActive: false,
        children: [node('c', '스킨케어')],
      }),
    ];
    const result = pruneTree(inactiveParent, (candidate) => candidate.isActive);
    expect(result[0].node.id).toBe('p');
    expect(result[0].matchedSelf).toBe(false);
    expect(result[0].children[0].node.id).toBe('c');
  });

  it('항상 참인 술어는 원본 구조를 보존한다', () => {
    const result = pruneTree(tree, () => true);
    expect(result).toHaveLength(2);
    expect(result[0].children[0].children).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: FAIL — `pruneTree is not a function`

- [ ] **Step 3: 구현을 추가한다**

```ts
/** 가지치기 결과 노드. `matchedSelf: false` = 자손 때문에 남은 구조 유지용. */
export type PrunedNode = {
  node: CategoryTreeNodeLike;
  /** 조상 + 자기 이름 */
  pathSegments: string[];
  matchedSelf: boolean;
  children: PrunedNode[];
};

/**
 * 노드가 보인다 = 본인이 술어를 통과 OR 자손 중 통과하는 게 있다.
 *
 * 이 한 규칙이 검색과 비활성 필터를 함께 처리한다. 따로 적용하면
 * `화장품(비활성) / 스킨케어(활성)` 에서 부모가 사라지며 활성 자식까지 증발한다.
 */
export function pruneTree(
  tree: CategoryTreeNodeLike[],
  predicate: (node: CategoryTreeNodeLike, pathSegments: string[]) => boolean
): PrunedNode[] {
  const walk = (
    nodes: CategoryTreeNodeLike[],
    pathSegments: string[]
  ): PrunedNode[] => {
    const out: PrunedNode[] = [];
    for (const node of nodes) {
      const nextPath = [...pathSegments, node.name];
      const children = node.children?.length ? walk(node.children, nextPath) : [];
      const matchedSelf = predicate(node, nextPath);
      if (matchedSelf || children.length > 0) {
        out.push({ node, pathSegments: nextPath, matchedSelf, children });
      }
    }
    return out;
  };
  return walk(tree, []);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: PASS (22 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/utils/category-tree.ts apps/admin-web/src/lib/utils/category-tree.spec.ts
git commit -m "feat(admin-web): 술어 하나로 검색·비활성을 처리하는 가지치기를 더한다 (#686)"
```

---

## Task 4: 공용 모듈 — 보이는 순서

**Files:**
- Modify: `apps/admin-web/src/lib/utils/category-tree.ts`
- Test: `apps/admin-web/src/lib/utils/category-tree.spec.ts`

**Interfaces:**
- Consumes: `PrunedNode` (Task 3)
- Produces:
  - `type VisibleNode = { node: CategoryTreeNodeLike; pathSegments: string[]; matchedSelf: boolean; depth: number; hasChildren: boolean; isExpanded: boolean; parentId: string | null }`
  - `visibleNodeSequence(pruned: PrunedNode[], expandedIds: ReadonlySet<string>): VisibleNode[]`

**배경:** 이 설계의 중심이다. **렌더 순서와 키보드 ↑↓ 순서가 이 함수 하나에서** 나오므로 둘이 어긋날 수 없다. 뷰는 이 배열을 그대로 그리고, 키보드는 이 배열의 인덱스로 움직인다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

```ts
import { visibleNodeSequence } from './category-tree';

describe('visibleNodeSequence', () => {
  const pruned = pruneTree(tree, () => true);

  it('아무것도 안 펼치면 루트만 낸다', () => {
    const result = visibleNodeSequence(pruned, new Set());
    expect(result.map((entry) => entry.node.id)).toEqual(['cosmetics', 'food']);
  });

  it('펼친 노드의 자식을 전위 순회 순서로 끼워 넣는다', () => {
    const result = visibleNodeSequence(pruned, new Set(['cosmetics']));
    expect(result.map((entry) => entry.node.id)).toEqual([
      'cosmetics',
      'skincare',
      'bodycare',
      'food',
    ]);
  });

  it('접힌 노드의 자식은 건너뛴다', () => {
    const result = visibleNodeSequence(pruned, new Set(['cosmetics']));
    expect(result.map((entry) => entry.node.id)).not.toContain('toner');
  });

  it('depth 와 parentId 를 채운다', () => {
    const result = visibleNodeSequence(pruned, new Set(['cosmetics', 'skincare']));
    const toner = result.find((entry) => entry.node.id === 'toner');
    expect(toner?.depth).toBe(2);
    expect(toner?.parentId).toBe('skincare');
    expect(result[0].depth).toBe(0);
    expect(result[0].parentId).toBeNull();
  });

  it('자식 없는 노드는 펼침 집합에 있어도 isExpanded 가 false 다', () => {
    const result = visibleNodeSequence(pruned, new Set(['food']));
    const food = result.find((entry) => entry.node.id === 'food');
    expect(food?.hasChildren).toBe(false);
    expect(food?.isExpanded).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: FAIL — `visibleNodeSequence is not a function`

- [ ] **Step 3: 구현을 추가한다**

```ts
/** 화면에 실제로 그려지는 행 하나. 렌더 순서이자 키보드 이동 순서다. */
export type VisibleNode = {
  node: CategoryTreeNodeLike;
  pathSegments: string[];
  matchedSelf: boolean;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  parentId: string | null;
};

/**
 * 가지친 트리 + 펼침 상태 → 화면에 보이는 순서 그대로의 평탄 배열.
 *
 * 뷰가 이 배열을 그리고 키보드가 이 배열의 인덱스로 움직인다. 둘이 같은
 * 출처를 쓰므로 "보이는 것"과 "이동하는 것"이 어긋날 수 없다.
 */
export function visibleNodeSequence(
  pruned: PrunedNode[],
  expandedIds: ReadonlySet<string>
): VisibleNode[] {
  const out: VisibleNode[] = [];
  const walk = (
    entries: PrunedNode[],
    depth: number,
    parentId: string | null
  ): void => {
    for (const entry of entries) {
      const hasChildren = entry.children.length > 0;
      const isExpanded = hasChildren && expandedIds.has(entry.node.id);
      out.push({
        node: entry.node,
        pathSegments: entry.pathSegments,
        matchedSelf: entry.matchedSelf,
        depth,
        hasChildren,
        isExpanded,
        parentId,
      });
      if (isExpanded) walk(entry.children, depth + 1, entry.node.id);
    }
  };
  walk(pruned, 0, null);
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: PASS (27 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/utils/category-tree.ts apps/admin-web/src/lib/utils/category-tree.spec.ts
git commit -m "feat(admin-web): 렌더와 키보드가 공유할 보이는순서 함수를 더한다 (#686)"
```

---

## Task 5: 공용 모듈 — 키보드 규칙

**Files:**
- Modify: `apps/admin-web/src/lib/utils/category-tree.ts`
- Test: `apps/admin-web/src/lib/utils/category-tree.spec.ts`

**Interfaces:**
- Consumes: `VisibleNode` (Task 4)
- Produces:
  - `type KeyboardMove = { nextIndex?: number; toggleExpandId?: string; selectId?: string }`
  - `resolveKeyboardMove(sequence: VisibleNode[], currentIndex: number, key: string): KeyboardMove | null`

**배경:** 스펙 §6. **스펙의 서명 스케치에는 `펼침집합` 인자가 있었으나 뺀다** — `VisibleNode.isExpanded` 가 이미 그 정보를 들고 있어 인자로 또 받으면 두 출처가 어긋날 수 있다. 의도된 변경이다.

`Esc` 는 이 함수가 다루지 않는다 (Radix Dialog 가 자체 처리). "검색창에서 `↓`" 도 별도 경로다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

```ts
import { resolveKeyboardMove } from './category-tree';

describe('resolveKeyboardMove', () => {
  const pruned = pruneTree(tree, () => true);
  // ['cosmetics', 'skincare', 'toner', 'cream-face', 'bodycare', 'food']
  const sequence = visibleNodeSequence(pruned, new Set(['cosmetics', 'skincare']));

  it('↓ 는 다음으로, ↑ 는 이전으로 간다', () => {
    expect(resolveKeyboardMove(sequence, 0, 'ArrowDown')).toEqual({ nextIndex: 1 });
    expect(resolveKeyboardMove(sequence, 2, 'ArrowUp')).toEqual({ nextIndex: 1 });
  });

  it('끝에서 더 가지 않는다', () => {
    const last = sequence.length - 1;
    expect(resolveKeyboardMove(sequence, last, 'ArrowDown')).toEqual({ nextIndex: last });
    expect(resolveKeyboardMove(sequence, 0, 'ArrowUp')).toEqual({ nextIndex: 0 });
  });

  it('포커스가 없으면(-1) ↓ 가 첫 항목으로 간다', () => {
    expect(resolveKeyboardMove(sequence, -1, 'ArrowDown')).toEqual({ nextIndex: 0 });
  });

  it('Home / End 로 양끝으로 간다', () => {
    expect(resolveKeyboardMove(sequence, 3, 'Home')).toEqual({ nextIndex: 0 });
    expect(resolveKeyboardMove(sequence, 0, 'End')).toEqual({
      nextIndex: sequence.length - 1,
    });
  });

  it('→ 는 접힌 노드를 펼치고, 이미 펼쳐졌으면 첫 자식으로 간다', () => {
    const collapsed = visibleNodeSequence(pruned, new Set());
    expect(resolveKeyboardMove(collapsed, 0, 'ArrowRight')).toEqual({
      toggleExpandId: 'cosmetics',
    });
    expect(resolveKeyboardMove(sequence, 0, 'ArrowRight')).toEqual({ nextIndex: 1 });
  });

  it('← 는 펼친 노드를 접고, 이미 접혔으면 부모로 간다', () => {
    expect(resolveKeyboardMove(sequence, 1, 'ArrowLeft')).toEqual({
      toggleExpandId: 'skincare',
    });
    expect(resolveKeyboardMove(sequence, 2, 'ArrowLeft')).toEqual({ nextIndex: 1 });
  });

  it('자식 없는 노드의 → 와 루트의 ← 는 아무것도 하지 않는다', () => {
    const foodIndex = sequence.findIndex((entry) => entry.node.id === 'food');
    expect(resolveKeyboardMove(sequence, foodIndex, 'ArrowRight')).toBeNull();
    expect(resolveKeyboardMove(sequence, foodIndex, 'ArrowLeft')).toBeNull();
  });

  it('Space 와 Enter 는 선택을 토글한다', () => {
    expect(resolveKeyboardMove(sequence, 2, ' ')).toEqual({ selectId: 'toner' });
    expect(resolveKeyboardMove(sequence, 2, 'Enter')).toEqual({ selectId: 'toner' });
  });

  it('모르는 키와 빈 목록은 null 이다', () => {
    expect(resolveKeyboardMove(sequence, 0, 'Tab')).toBeNull();
    expect(resolveKeyboardMove([], 0, 'ArrowDown')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: FAIL — `resolveKeyboardMove is not a function`

- [ ] **Step 3: 구현을 추가한다**

```ts
/** 키 입력이 만들어내는 동작. 훅은 이걸 받아 상태에 반영하기만 한다. */
export type KeyboardMove = {
  nextIndex?: number;
  toggleExpandId?: string;
  selectId?: string;
};

/**
 * 트리에 포커스가 있을 때의 키 규칙.
 *
 * `Esc` 는 다루지 않는다 — Radix Dialog 가 자체 처리한다.
 * "검색창에서 ↓" 도 여기 없다 — 검색 입력이 포커스를 0번으로 옮기는 별도 경로다.
 */
export function resolveKeyboardMove(
  sequence: VisibleNode[],
  currentIndex: number,
  key: string
): KeyboardMove | null {
  if (sequence.length === 0) return null;
  const lastIndex = sequence.length - 1;
  const current: VisibleNode | undefined = sequence[currentIndex];

  switch (key) {
    case 'ArrowDown':
      return { nextIndex: Math.min(currentIndex + 1, lastIndex) };
    case 'ArrowUp':
      return { nextIndex: Math.max(currentIndex - 1, 0) };
    case 'Home':
      return { nextIndex: 0 };
    case 'End':
      return { nextIndex: lastIndex };
    case 'ArrowRight': {
      if (!current || !current.hasChildren) return null;
      if (!current.isExpanded) return { toggleExpandId: current.node.id };
      return { nextIndex: Math.min(currentIndex + 1, lastIndex) };
    }
    case 'ArrowLeft': {
      if (!current) return null;
      if (current.hasChildren && current.isExpanded) {
        return { toggleExpandId: current.node.id };
      }
      if (!current.parentId) return null;
      const parentId = current.parentId;
      const parentIndex = sequence.findIndex((entry) => entry.node.id === parentId);
      return parentIndex >= 0 ? { nextIndex: parentIndex } : null;
    }
    case ' ':
    case 'Enter':
      return current ? { selectId: current.node.id } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- category-tree`
Expected: PASS (36 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/utils/category-tree.ts apps/admin-web/src/lib/utils/category-tree.spec.ts
git commit -m "feat(admin-web): 트리 키보드 규칙을 순수 함수로 뽑는다 (#686)"
```

---

## Task 6: 관리 페이지 훅 이관

**Files:**
- Modify: `apps/admin-web/src/features/mall/categories/hooks/use-tree-expansion.ts`

**Interfaces:**
- Consumes: `collectAllIds`, `collectSearchExpansion` (Task 2)
- Produces: 변화 없음 — `useTreeExpansion(tree, search)` 의 반환 형태 `{ effectiveExpanded, matchedIds, toggleExpand, expandAll, collapseAll }` 를 **그대로 유지**한다

**배경:** 이 훅은 살아 있는 카테고리 관리 페이지가 쓴다 (`components/tree/index.tsx:37`). 인터페이스를 바꾸면 그 페이지가 깨진다. 지역 함수 `matches` / `collectAncestorsOfMatches` / `collectAllIds` 만 삭제하고 공용 함수로 교체한다.

**회귀 없음의 근거:** 관리 페이지 검색은 공백 없는 단일 토큰이 대부분이고, 단일 토큰일 때 새 매칭 규칙은 기존과 동치다 (앞 토큰이 없으면 `locators.every` 가 빈 배열에 대해 항상 참). 공백이 들어간 검색만 동작이 바뀌는데, 기존에는 `name.includes('바디 크림')` 이라 사실상 항상 0건이었다.

- [ ] **Step 1: 훅 내부를 교체한다**

`apps/admin-web/src/features/mall/categories/hooks/use-tree-expansion.ts` 전체를 아래로 바꾼다:

```ts
'use client';

import { useCallback, useMemo, useState } from 'react';
import { collectAllIds, collectSearchExpansion } from '@/lib/utils/category-tree';
import type { CategoryNode } from '../tree-state';

interface Result {
  effectiveExpanded: Set<string>;
  matchedIds: Set<string>;
  toggleExpand: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/**
 * 트리 펼침 상태 관리. 검색어가 비어있을 때는 사용자가 직접 토글한 노드만
 * 펼쳐져 있고, 검색어가 있을 때는 매치 노드의 조상을 자동으로 추가 펼침한다
 * (사용자 토글은 그대로 유지하다가 검색어 비우면 자동 펼침만 사라짐).
 *
 * 매칭·순회 규칙은 `@/lib/utils/category-tree` 가 소유한다 — 상품 카테고리
 * 선택기와 같은 규칙을 쓰기 위해서다.
 */
export function useTreeExpansion(tree: CategoryNode[], search: string): Result {
  const [userExpanded, setUserExpanded] = useState<Set<string>>(new Set());

  const { matchedIds, expandedIds } = useMemo(
    () => collectSearchExpansion(tree, search),
    [tree, search]
  );

  const effectiveExpanded = useMemo(() => {
    const out = new Set(userExpanded);
    for (const id of expandedIds) out.add(id);
    return out;
  }, [userExpanded, expandedIds]);

  const toggleExpand = useCallback((id: string) => {
    setUserExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setUserExpanded(collectAllIds(tree)), [tree]);

  const collapseAll = useCallback(() => setUserExpanded(new Set()), []);

  return { effectiveExpanded, matchedIds, toggleExpand, expandAll, collapseAll };
}
```

- [ ] **Step 2: 타입이 맞는지 확인한다**

Run: `npm run type-check`
Expected: 에러 0건

`CategoryNode` 가 `CategoryTreeNodeLike` 를 구조적으로 만족하는지가 관건이다 — `id`, `name`, `slug?`, `description?`, `isActive`, `children` 을 모두 갖고 있으므로 통과해야 한다. 실패하면 `CategoryNode` 를 고치지 말고 `CategoryTreeNodeLike` 의 필드 선택성을 재검토할 것.

- [ ] **Step 3: 전체 테스트를 돌린다**

Run: `npx jest --maxWorkers=2`
Expected: 실패 0건

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/mall/categories/hooks/use-tree-expansion.ts
git commit -m "refactor(admin-web): 관리 페이지 트리 펼침을 공용 함수 위로 옮긴다 (#686)"
```

---

## Task 7: 선택기 모델

**Files:**
- Create: `apps/admin-web/src/features/mall/products-detail/components/general/category-selection-model.ts`
- Test: `apps/admin-web/src/features/mall/products-detail/components/general/category-selection-model.spec.ts`

**Interfaces:**
- Consumes: `CategoryTreeNodeLike`, `matchesCategory`, `normalizeSearchTerm` (Task 1)
- Produces:
  - `type CategorySelectionState = { selectedIds: string[]; primaryId: string | null }`
  - `toggleCategorySelection(state, id: string, orderedIds: string[]): CategorySelectionState`
  - `setPrimaryCategory(state, id: string): CategorySelectionState`
  - `buildCategoryPathLabels(tree: CategoryTreeNodeLike[]): Map<string, string>`
  - `createVisibilityPredicate(options: { query: string; includeInactive: boolean; selectedIds: ReadonlySet<string> }): (node: CategoryTreeNodeLike, pathSegments: string[]) => boolean`

**배경:** 스펙 §5·§6. 대표 승계 규칙과 비활성 정책이 여기 산다. **이미 선택된 비활성 카테고리는 토글과 무관하게 항상 통과**시켜야 한다 — 아니면 잘못 붙은 것을 뗄 방법이 사라진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`category-selection-model.spec.ts`:

```ts
import {
  buildCategoryPathLabels,
  createVisibilityPredicate,
  setPrimaryCategory,
  toggleCategorySelection,
} from './category-selection-model';
import type { CategoryTreeNodeLike } from '@/lib/utils/category-tree';

const node = (
  id: string,
  name: string,
  extra: Partial<CategoryTreeNodeLike> = {}
): CategoryTreeNodeLike => ({ id, name, isActive: true, ...extra });

const tree: CategoryTreeNodeLike[] = [
  node('cosmetics', '화장품', {
    children: [node('skincare', '스킨케어', { children: [node('toner', '토너')] })],
  }),
  node('food', '식품'),
];

const orderedIds = ['cosmetics', 'skincare', 'toner', 'food'];

describe('toggleCategorySelection', () => {
  const empty = { selectedIds: [], primaryId: null };

  it('첫 선택은 대표가 된다', () => {
    expect(toggleCategorySelection(empty, 'toner', orderedIds)).toEqual({
      selectedIds: ['toner'],
      primaryId: 'toner',
    });
  });

  it('선택 순서와 무관하게 트리 순서로 정렬한다', () => {
    const afterFood = toggleCategorySelection(empty, 'food', orderedIds);
    const afterToner = toggleCategorySelection(afterFood, 'toner', orderedIds);
    expect(afterToner.selectedIds).toEqual(['toner', 'food']);
  });

  it('대표는 정렬이 바뀌어도 유지된다', () => {
    const afterFood = toggleCategorySelection(empty, 'food', orderedIds);
    const afterToner = toggleCategorySelection(afterFood, 'toner', orderedIds);
    expect(afterToner.primaryId).toBe('food');
  });

  it('대표를 해제하면 남은 것 중 첫 번째로 승계한다', () => {
    const state = { selectedIds: ['toner', 'food'], primaryId: 'toner' };
    expect(toggleCategorySelection(state, 'toner', orderedIds)).toEqual({
      selectedIds: ['food'],
      primaryId: 'food',
    });
  });

  it('전부 해제하면 대표가 null 이 된다', () => {
    const state = { selectedIds: ['toner'], primaryId: 'toner' };
    expect(toggleCategorySelection(state, 'toner', orderedIds)).toEqual({
      selectedIds: [],
      primaryId: null,
    });
  });
});

describe('setPrimaryCategory', () => {
  it('선택된 것만 대표가 될 수 있다', () => {
    const state = { selectedIds: ['toner', 'food'], primaryId: 'toner' };
    expect(setPrimaryCategory(state, 'food').primaryId).toBe('food');
  });

  it('선택되지 않은 id 는 무시한다', () => {
    const state = { selectedIds: ['toner'], primaryId: 'toner' };
    expect(setPrimaryCategory(state, 'food')).toEqual(state);
  });
});

describe('buildCategoryPathLabels', () => {
  it('조상부터 이어붙인 경로 라벨을 만든다', () => {
    const labels = buildCategoryPathLabels(tree);
    expect(labels.get('toner')).toBe('화장품 / 스킨케어 / 토너');
    expect(labels.get('food')).toBe('식품');
  });
});

describe('createVisibilityPredicate', () => {
  const inactive = node('gone', '단종', { isActive: false });

  it('검색어가 없으면 활성 노드를 통과시킨다', () => {
    const predicate = createVisibilityPredicate({
      query: '',
      includeInactive: false,
      selectedIds: new Set(),
    });
    expect(predicate(node('toner', '토너'), ['토너'])).toBe(true);
  });

  it('비활성은 기본적으로 막는다', () => {
    const predicate = createVisibilityPredicate({
      query: '',
      includeInactive: false,
      selectedIds: new Set(),
    });
    expect(predicate(inactive, ['단종'])).toBe(false);
  });

  it('토글을 켜면 비활성도 통과한다', () => {
    const predicate = createVisibilityPredicate({
      query: '',
      includeInactive: true,
      selectedIds: new Set(),
    });
    expect(predicate(inactive, ['단종'])).toBe(true);
  });

  it('이미 선택된 비활성은 토글과 무관하게 통과한다', () => {
    const predicate = createVisibilityPredicate({
      query: '',
      includeInactive: false,
      selectedIds: new Set(['gone']),
    });
    expect(predicate(inactive, ['단종'])).toBe(true);
  });

  it('검색어가 있으면 비활성 정책과 매칭을 함께 적용한다', () => {
    const predicate = createVisibilityPredicate({
      query: '토너',
      includeInactive: false,
      selectedIds: new Set(),
    });
    expect(predicate(node('toner', '토너'), ['화장품', '토너'])).toBe(true);
    expect(predicate(node('food', '식품'), ['식품'])).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- category-selection-model`
Expected: FAIL — `Cannot find module './category-selection-model'`

- [ ] **Step 3: 구현을 쓴다**

`category-selection-model.ts`:

```ts
import {
  matchesCategory,
  normalizeSearchTerm,
  type CategoryTreeNodeLike,
} from '@/lib/utils/category-tree';

export type CategorySelectionState = {
  /** 트리 전위 순회 순서로 정렬된다. 사용자가 고른 순서가 아니다. */
  selectedIds: string[];
  primaryId: string | null;
};

/**
 * 선택 토글 + 대표 승계.
 *
 * 대표 규칙: 없으면 첫 번째가 되고, 해제되면 남은 것 중 첫 번째로 승계하고,
 * 전부 해제되면 null 이 된다.
 */
export function toggleCategorySelection(
  state: CategorySelectionState,
  id: string,
  orderedIds: string[]
): CategorySelectionState {
  const selected = new Set(state.selectedIds);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);

  const selectedIds = orderedIds.filter((candidate) => selected.has(candidate));
  const primaryId =
    state.primaryId && selectedIds.includes(state.primaryId)
      ? state.primaryId
      : (selectedIds[0] ?? null);

  return { selectedIds, primaryId };
}

/** 선택된 카테고리만 대표가 될 수 있다. */
export function setPrimaryCategory(
  state: CategorySelectionState,
  id: string
): CategorySelectionState {
  if (!state.selectedIds.includes(id)) return state;
  return { ...state, primaryId: id };
}

/** `화장품 / 스킨케어 / 토너` 꼴의 표시용 경로 라벨. 선택됨 패널이 쓴다. */
export function buildCategoryPathLabels(
  tree: CategoryTreeNodeLike[]
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (nodes: CategoryTreeNodeLike[], pathSegments: string[]): void => {
    for (const node of nodes) {
      const nextPath = [...pathSegments, node.name];
      out.set(node.id, nextPath.join(' / '));
      if (node.children?.length) walk(node.children, nextPath);
    }
  };
  walk(tree, []);
  return out;
}

/**
 * `pruneTree` 에 넘길 술어. 비활성 정책과 검색 매칭의 합성이다.
 *
 * 이미 선택된 비활성 카테고리는 토글과 무관하게 항상 통과시킨다 —
 * 아니면 잘못 붙은 카테고리를 뗄 방법이 사라진다.
 */
export function createVisibilityPredicate(options: {
  query: string;
  includeInactive: boolean;
  selectedIds: ReadonlySet<string>;
}): (node: CategoryTreeNodeLike, pathSegments: string[]) => boolean {
  const hasQuery = normalizeSearchTerm(options.query).length > 0;

  return (node, pathSegments) => {
    const inactiveBlocked =
      !node.isActive && !options.includeInactive && !options.selectedIds.has(node.id);
    if (inactiveBlocked) return false;
    if (!hasQuery) return true;
    return matchesCategory(node, pathSegments, options.query);
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- category-selection-model`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-detail/components/general/category-selection-model.ts apps/admin-web/src/features/mall/products-detail/components/general/category-selection-model.spec.ts
git commit -m "feat(admin-web): 카테고리 선택 상태 규칙을 순수 함수로 뽑는다 (#686)"
```

---

## Task 8: 트리 행 컴포넌트

**Files:**
- Create: `apps/admin-web/src/features/mall/products-detail/components/general/category-selection-tree-node.tsx`

**Interfaces:**
- Consumes: `VisibleNode`, `CategoryTreeNodeLike` (Task 4)
- Produces: `CategorySelectionTreeRow` — props `{ entry: VisibleNode, isSelected, isPrimary, isMatched, isFocused, disabled, onToggleExpand, onToggleSelect, onSetPrimary }`

**배경:** 스펙 §7. 행은 **평소에 조용해야** 한다 — slug 는 항상, 뱃지는 예외 상태(비활성/멤버십 전용)일 때만, 대표 버튼은 선택된 행에만.

`entry.matchedSelf === false` 는 "자손 때문에 남은 구조 유지용 노드"다. 흐리게 그리고 **체크박스를 잠근다** (그 노드 자체는 필터를 통과하지 못했으므로 선택 대상이 아니다).

이 파일은 `.tsx` 라 **테스트할 수 없다.** 검증은 `type-check` 와 수동 스모크뿐이다.

- [ ] **Step 1: 컴포넌트를 만든다**

```tsx
'use client';

import { ChevronRight, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils/ui';
import type { VisibleNode } from '@/lib/utils/category-tree';

export function CategorySelectionTreeRow({
  entry,
  isSelected,
  isPrimary,
  isMatched,
  isFocused,
  disabled,
  onToggleExpand,
  onToggleSelect,
  onSetPrimary,
}: {
  entry: VisibleNode;
  isSelected: boolean;
  isPrimary: boolean;
  isMatched: boolean;
  isFocused: boolean;
  disabled: boolean;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSetPrimary: (id: string) => void;
}) {
  const { node, depth, hasChildren, isExpanded, matchedSelf } = entry;
  // 자손 때문에 남은 구조 유지용 노드는 스스로 선택될 수 없다.
  const selectable = matchedSelf && !disabled;
  const checkboxId = `product-category-${node.id}`;

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
      data-focused={isFocused ? 'true' : undefined}
      className={cn(
        'flex min-h-9 items-center gap-2 pr-3 text-sm',
        isSelected && 'bg-muted/60',
        isMatched && 'font-medium',
        !matchedSelf && 'opacity-45',
        isFocused && 'ring-2 ring-ring ring-inset'
      )}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={isExpanded ? '접기' : '펼치기'}
          className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
          onClick={() => onToggleExpand(node.id)}
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')}
          />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}

      <Checkbox
        id={checkboxId}
        checked={isSelected}
        disabled={!selectable}
        onCheckedChange={() => onToggleSelect(node.id)}
      />

      <label
        htmlFor={checkboxId}
        className={cn(
          'min-w-0 flex-1 truncate py-1',
          selectable ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        {node.name}
      </label>

      <div className="flex shrink-0 items-center gap-2">
        {node.slug && (
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {node.slug}
          </span>
        )}
        {!node.isActive && <Badge variant="secondary">비활성</Badge>}
        {node.isVisibleToMembersOnly && <Badge variant="outline">멤버십 전용</Badge>}
        {isSelected && (
          <Button
            type="button"
            size="sm"
            variant={isPrimary ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => onSetPrimary(node.id)}
          >
            <Star data-icon="inline-start" />
            대표
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입을 확인한다**

Run: `npm run type-check`
Expected: 에러 0건

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-detail/components/general/category-selection-tree-node.tsx
git commit -m "feat(admin-web): 카테고리 선택 트리 행 컴포넌트를 만든다 (#686)"
```

---

## Task 9: 모달 재작성과 배선

**Files:**
- Modify (전면 재작성): `apps/admin-web/src/features/mall/products-detail/components/general/category-selection-modal.tsx`
- Modify: `apps/admin-web/src/features/mall/products-detail/components/general/index.tsx` (모달 호출부 `:480-495`, `categoryOptions` 정의 `:135-138`)

**Interfaces:**
- Consumes: Task 2·3·4·5 의 공용 함수, Task 7 의 모델, Task 8 의 `CategorySelectionTreeRow`
- Produces: `ProductCategorySelectionModal` — prop `options: SelectableCategory[]` 가 **`tree: CategoryTreeNodeLike[]` 로 바뀐다.** `onApply(categoryIds, primaryCategoryId)` 서명은 그대로

**배경:** 스펙 §7. 크기는 `!max-w-[96vw] sm:!max-w-[96vw] h-[92vh]`, 목록의 `h-[430px]` 고정을 걷어내고 `flex-1 min-h-0` 사슬로 잇는다.

`index.tsx` 의 `flattenCategoryTree` / `categoryOptions` / `labelByCategoryId` 는 **지우지 않는다** — 서랍 본문의 요약 줄(`selectedCategorySummary`, `primaryCategoryLabel`)이 계속 쓴다. 모달에 넘기는 prop 만 트리로 바꾼다.

- [ ] **Step 1: 모달을 재작성한다**

`category-selection-modal.tsx` 전체를 아래로 바꾼다:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  collectAncestorIds,
  collectAllIds,
  collectSearchExpansion,
  orderedCategoryIds,
  pruneTree,
  resolveKeyboardMove,
  visibleNodeSequence,
  type CategoryTreeNodeLike,
} from '@/lib/utils/category-tree';
import {
  buildCategoryPathLabels,
  createVisibilityPredicate,
  setPrimaryCategory,
  toggleCategorySelection,
  type CategorySelectionState,
} from './category-selection-model';
import { CategorySelectionTreeRow } from './category-selection-tree-node';

export function ProductCategorySelectionModal({
  open,
  onOpenChange,
  tree,
  isLoading,
  selectedIds,
  primaryCategoryId,
  disabled,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: CategoryTreeNodeLike[];
  isLoading: boolean;
  selectedIds: string[];
  primaryCategoryId: string | null;
  disabled: boolean;
  onApply: (categoryIds: string[], primaryCategoryId: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [userExpanded, setUserExpanded] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [draft, setDraft] = useState<CategorySelectionState>({
    selectedIds,
    primaryId: primaryCategoryId,
  });
  const listRef = useRef<HTMLDivElement>(null);

  // 열릴 때마다 초기화한다. 펼침은 "이미 선택된 것들의 조상"에서 시작해야
  // 열자마자 무엇을 골라놨는지 트리에서 보인다.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setIncludeInactive(false);
    setFocusIndex(-1);
    setDraft({ selectedIds, primaryId: primaryCategoryId });
    setUserExpanded(collectAncestorIds(tree, selectedIds));
  }, [open, tree, selectedIds, primaryCategoryId]);

  const busy = disabled || isLoading;
  const draftSelectedSet = useMemo(() => new Set(draft.selectedIds), [draft.selectedIds]);
  const orderedIds = useMemo(() => orderedCategoryIds(tree), [tree]);
  const pathLabels = useMemo(() => buildCategoryPathLabels(tree), [tree]);

  const { matchedIds, expandedIds } = useMemo(
    () => collectSearchExpansion(tree, search),
    [tree, search]
  );

  const pruned = useMemo(
    () =>
      pruneTree(
        tree,
        createVisibilityPredicate({
          query: search,
          includeInactive,
          selectedIds: draftSelectedSet,
        })
      ),
    [tree, search, includeInactive, draftSelectedSet]
  );

  const effectiveExpanded = useMemo(() => {
    const out = new Set(userExpanded);
    for (const id of expandedIds) out.add(id);
    return out;
  }, [userExpanded, expandedIds]);

  const sequence = useMemo(
    () => visibleNodeSequence(pruned, effectiveExpanded),
    [pruned, effectiveExpanded]
  );

  const toggleExpand = useCallback((id: string) => {
    setUserExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelect = useCallback(
    (id: string) => {
      setDraft((prev) => toggleCategorySelection(prev, id, orderedIds));
    },
    [orderedIds]
  );

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const move = resolveKeyboardMove(sequence, focusIndex, event.key);
    if (!move) return;
    event.preventDefault();
    if (move.nextIndex !== undefined) setFocusIndex(move.nextIndex);
    if (move.toggleExpandId) toggleExpand(move.toggleExpandId);
    if (move.selectId) toggleSelect(move.selectId);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowDown' || sequence.length === 0) return;
    event.preventDefault();
    setFocusIndex(0);
    listRef.current?.focus();
  };

  const handleApply = () => {
    onApply(draft.selectedIds, draft.primaryId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex h-[92vh] !max-w-[96vw] flex-col gap-0 p-0 sm:!max-w-[96vw]">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>카테고리 선택</DialogTitle>
          <DialogDescription>
            상품을 노출할 카테고리를 선택하고 대표 카테고리를 지정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 border-y px-6 py-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="카테고리명·slug·경로 검색 (예: 바디 크림)"
              className="pl-9"
              disabled={busy}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              id="category-include-inactive"
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
              disabled={busy}
            />
            <Label htmlFor="category-include-inactive" className="text-sm">
              비활성 포함
            </Label>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setUserExpanded(new Set())}
          >
            모두 접기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setUserExpanded(collectAllIds(tree))}
          >
            모두 펼치기
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-h-0 rounded-md border">
            <ScrollArea className="h-full">
              {isLoading ? (
                <div className="flex min-h-[240px] items-center justify-center">
                  <Spinner />
                </div>
              ) : sequence.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  조건에 맞는 카테고리가 없습니다.
                </div>
              ) : (
                <div
                  ref={listRef}
                  role="tree"
                  tabIndex={0}
                  onKeyDown={handleTreeKeyDown}
                  className="divide-y outline-none"
                >
                  {sequence.map((entry, index) => (
                    <CategorySelectionTreeRow
                      key={entry.node.id}
                      entry={entry}
                      isSelected={draftSelectedSet.has(entry.node.id)}
                      isPrimary={draft.primaryId === entry.node.id}
                      isMatched={matchedIds.has(entry.node.id)}
                      isFocused={focusIndex === index}
                      disabled={busy}
                      onToggleExpand={toggleExpand}
                      onToggleSelect={toggleSelect}
                      onSetPrimary={(id) =>
                        setDraft((prev) => setPrimaryCategory(prev, id))
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label>선택됨</Label>
              <span className="text-sm text-muted-foreground">
                {draft.selectedIds.length}개
              </span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {draft.selectedIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  선택된 카테고리가 없습니다.
                </p>
              ) : (
                <div className="flex flex-col gap-2 pr-2">
                  {draft.selectedIds.map((id) => (
                    <div key={id} className="rounded-md border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm">
                          {pathLabels.get(id) ?? id}
                        </p>
                        {draft.primaryId === id && <Badge>대표</Badge>}
                      </div>
                      <div className="mt-2 flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={draft.primaryId === id ? 'default' : 'ghost'}
                          disabled={busy}
                          onClick={() =>
                            setDraft((prev) => setPrimaryCategory(prev, id))
                          }
                        >
                          <Star data-icon="inline-start" />
                          대표
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label="선택 해제"
                          disabled={busy}
                          onClick={() =>
                            setDraft((prev) =>
                              toggleCategorySelection(prev, id, orderedIds)
                            )
                          }
                        >
                          <X data-icon="inline-start" />
                          제거
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button type="button" disabled={busy} onClick={handleApply}>
            적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: import 를 확인한다**

`@/components/ui/switch` 는 이미 존재한다 (`apps/admin-web/src/components/ui/switch.tsx`).
새 shadcn 컴포넌트를 이 작업에서 추가하지 말 것 — 범위 밖이다.

- [ ] **Step 3: `index.tsx` 배선을 바꾼다**

`:480-495` 의 모달 호출에서 `options={categoryOptions}` 를 지우고 트리를 넘긴다:

```tsx
<ProductCategorySelectionModal
  open={categoryModalOpen}
  onOpenChange={setCategoryModalOpen}
  tree={categoryTree?.categories ?? []}
  isLoading={categoriesLoading}
  selectedIds={values.categoryIds}
  primaryCategoryId={values.primaryCategoryId}
  disabled={updateVersion.isPending}
  onApply={(categoryIds, primaryCategoryId) => {
    setValues((current) => ({
      ...current,
      categoryIds,
      primaryCategoryId,
    }));
  }}
/>
```

`categoryOptions` / `flattenCategoryTree` / `labelByCategoryId` 는 **그대로 둔다** — 서랍 본문의 `selectedCategorySummary` 와 `primaryCategoryLabel` 이 쓴다.

- [ ] **Step 4: 타입과 전체 테스트를 확인한다**

Run: `npm run type-check`
Expected: 에러 0건

Run: `npx jest --maxWorkers=2`
Expected: 실패 0건

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-detail/components/general/category-selection-modal.tsx apps/admin-web/src/features/mall/products-detail/components/general/index.tsx
git commit -m "feat(admin-web): 카테고리 선택기를 전체화면 트리로 바꾼다 (#686)"
```

---

## Task 10: dead code 삭제와 최종 검증

**Files:**
- Delete: `apps/admin-web/src/components/common/category-tree-select.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

**배경:** 285줄 dead code. 참조 0곳이며 `useCategoryChildren` 으로 레벨마다 따로 fetch 하는 구조라 전체 트리를 한 번에 받는 현재 방식과 맞지 않는다. 컬럼 브라우저 방식도 설계 단계에서 기각됐다.

**결합은 경로 grep 이 아니라 삭제 후 타입체크로 센다.**

- [ ] **Step 1: 참조가 없음을 확인한다**

```bash
grep -rn "category-tree-select\|CategoryTreeSelect" apps/admin-web/src \
  | grep -v "components/common/category-tree-select.tsx"
```

Expected: 출력 없음. 출력이 있으면 **삭제하지 말고 멈춘 뒤 보고할 것.**

- [ ] **Step 2: 삭제한다**

```bash
git rm apps/admin-web/src/components/common/category-tree-select.tsx
```

- [ ] **Step 3: 검증 게이트 두 개를 돌린다**

Run: `npm run type-check`
Expected: 에러 0건

Run: `npx jest --maxWorkers=2`
Expected: 실패 0건

- [ ] **Step 4: 커밋**

```bash
git commit -m "chore(admin-web): 쓰이지 않는 컬럼형 카테고리 선택기를 지운다 (#686)"
```

- [ ] **Step 5: 수동 스모크 10건을 사람에게 넘긴다**

`.tsx` 는 테스트할 수 없으므로 여기서 자동 검증이 끝난다. 아래 목록을 사람에게 전달하고 **결과를 듣기 전에는 완료라고 보고하지 말 것.**

1. 카테고리 여러 개 선택 → 적용 → 서랍 요약 줄 반영 → 저장
2. 재진입 시 선택된 것들의 조상이 펼쳐져 있는지
3. `바디 크림` 처럼 공백 검색 → 매치가 좁혀지는지
4. `화장품` 처럼 루트 이름 검색 → 트리가 폭발하지 않는지
5. 비활성 토글 껐을 때 비활성 부모 아래 활성 자식이 보이는지
6. 이미 선택된 비활성 카테고리를 뗄 수 있는지
7. 선택됨 패널의 `제거` 와 `대표`
8. 키보드만으로 검색 → `↓` 진입 → 이동 → `Space` 선택 → 적용, `Esc` 로 닫기
9. **관리 페이지 회귀** (`/mall/categories`) — 드래그앤드롭 이동, 검색, 저장
10. 상품 목록 카테고리 필터가 그대로 동작하는지

---

## 스펙 커버리지

| 스펙 절 | 담당 |
|---|---|
| §3 공용 순수 모듈 | Task 1–5 |
| §3 선택기 전용 모듈 | Task 7 |
| §3 관리 페이지 이관 | Task 6 |
| §3 삭제 / 유지 | Task 10 / Task 9 Step 3 |
| §4 검색 매칭 | Task 1 |
| §5 가시성·비활성 | Task 3 (`pruneTree`) + Task 7 (술어) |
| §6 펼침 두 겹 | Task 9 (`userExpanded` + `expandedIds`) |
| §6 선택·대표 | Task 7 |
| §6 키보드 | Task 5 (규칙) + Task 9 (배선) |
| §7 크기·행 구성·배선 | Task 8, Task 9 |
| §8 검증·스모크 | Task 10 |

## 스펙에서 의도적으로 벗어난 곳

- **`resolveKeyboardMove` 에서 `펼침집합` 인자를 뺐다** (Task 5). `VisibleNode.isExpanded` 가 이미 그 정보를 들고 있어 두 출처가 어긋날 위험이 있다
- **`Home` / `End` 키를 더했다** (Task 5). 스펙 표에는 없으나 트리뷰 표준 동작이고 비용이 거의 없다
- **`모두 펼치기` 버튼을 더했다** (Task 9). `collectAllIds` 가 이미 있고 관리 페이지가 같은 쌍을 제공한다
