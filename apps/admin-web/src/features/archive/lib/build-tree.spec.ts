import {
  buildArchiveTree,
  collectSubtreeIds,
  findAncestorIds,
  siblingsOf,
} from './build-tree';
import type { ArchivePageNodeDto } from '@/lib/types/dto/archive';

function node(
  id: string,
  parentId: string | null,
  sortKey = 'a0',
  title = id
): ArchivePageNodeDto {
  return {
    id,
    parentId,
    space: 'team',
    title,
    icon: null,
    sortKey,
    hasChildren: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('buildArchiveTree', () => {
  it('부모-자식을 이어 붙이고 정렬 키 순으로 정렬한다', () => {
    const tree = buildArchiveTree([
      node('b', null, 'a1'),
      node('a', null, 'a0'),
      node('a2', 'a', 'a1'),
      node('a1', 'a', 'a0'),
    ]);

    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['a1', 'a2']);
  });

  it('부모가 목록에 없는 페이지는 사라지지 않고 루트로 올라온다', () => {
    const tree = buildArchiveTree([node('orphan', 'missing-parent')]);

    expect(tree.map((n) => n.id)).toEqual(['orphan']);
  });

  it('부모 관계가 순환해도 멈추지 않고 전부 그린다', () => {
    const tree = buildArchiveTree([node('x', 'y'), node('y', 'x')]);

    const rendered = new Set<string>();
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        rendered.add(n.id);
        walk(n.children);
      }
    };
    walk(tree);

    expect(rendered).toEqual(new Set(['x', 'y']));
  });

  it('정렬 키가 겹쳐도 순서가 흔들리지 않는다 — id 로 마무리한다', () => {
    const first = buildArchiveTree([
      node('n2', null, 'a0', '나'),
      node('n1', null, 'a0', '가'),
    ]);
    const second = buildArchiveTree([
      node('n1', null, 'a0', '가'),
      node('n2', null, 'a0', '나'),
    ]);

    expect(first.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(second.map((n) => n.id)).toEqual(first.map((n) => n.id));
  });

  it('정렬 키는 문자열 비교라 자릿수가 늘어도 순서가 맞다', () => {
    const tree = buildArchiveTree([
      node('third', null, 'a1'),
      node('second', null, 'a0V'),
      node('first', null, 'a0'),
    ]);

    expect(tree.map((n) => n.id)).toEqual(['first', 'second', 'third']);
  });
});

describe('collectSubtreeIds', () => {
  it('자기 자신과 모든 하위를 담는다', () => {
    const [root] = buildArchiveTree([
      node('root', null),
      node('child', 'root'),
      node('grandchild', 'child'),
    ]);

    expect(collectSubtreeIds(root)).toEqual(
      new Set(['root', 'child', 'grandchild'])
    );
  });
});

describe('findAncestorIds', () => {
  it('가까운 부모부터 위로 올라간다', () => {
    const nodes = [
      node('root', null),
      node('mid', 'root'),
      node('leaf', 'mid'),
    ];

    expect(findAncestorIds(nodes, 'leaf')).toEqual(['mid', 'root']);
    expect(findAncestorIds(nodes, 'root')).toEqual([]);
  });

  it('순환이 있어도 무한히 돌지 않는다', () => {
    const nodes = [node('x', 'y'), node('y', 'x')];

    expect(findAncestorIds(nodes, 'x')).toEqual(['y', 'x']);
  });
});

describe('siblingsOf', () => {
  it('같은 부모를 둔 페이지만 정렬해 돌려준다', () => {
    const nodes = [
      node('a', null, 'a1'),
      node('b', null, 'a0'),
      node('c', 'a', 'a0'),
    ];

    expect(siblingsOf(nodes, null).map((n) => n.id)).toEqual(['b', 'a']);
    expect(siblingsOf(nodes, 'a').map((n) => n.id)).toEqual(['c']);
  });
});
