import {
  collectAllIds,
  collectAncestorIds,
  collectSearchExpansion,
  matchesCategory,
  normalizeSearchTerm,
  orderedCategoryIds,
  pruneTree,
  resolveKeyboardMove,
  visibleNodeSequence,
} from './category-tree';
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

  it('위치 한정이 이름 경로에 안 걸려도 설명 전체 부분일치면 매치한다 (관리 페이지 옛 동작 보존)', () => {
    const skincare = node('sc', '스킨케어', { description: '바디 크림 전용 카테고리' });
    expect(matchesCategory(skincare, ['뷰티', '스킨케어'], '바디 크림')).toBe(true);
  });
});

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
