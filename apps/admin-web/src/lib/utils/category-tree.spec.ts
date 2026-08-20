import {
  collectAllIds,
  collectAncestorIds,
  collectSearchExpansion,
  matchesCategory,
  normalizeSearchTerm,
  orderedCategoryIds,
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
