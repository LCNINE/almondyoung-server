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
