import { ArchiveMapper } from './archive.mapper';
import type { ArchiveNodeRow, ArchiveTrashRow } from '../archive.reader';

const AT = new Date('2026-09-01T00:00:00.000Z');

function node(id: string, parentId: string | null, title = id): ArchiveNodeRow {
  return { id, parentId, space: 'team', title, icon: null, sortKey: 'a0', updatedAt: AT };
}

function trashRow(id: string, parentId: string | null): ArchiveTrashRow {
  return { ...node(id, parentId), deletedAt: AT, deletedBy: 'user-1' };
}

describe('ArchiveMapper.toNodes', () => {
  it('자식이 있는 노드에만 hasChildren 을 세운다', () => {
    const nodes = ArchiveMapper.toNodes([node('a', null), node('b', 'a'), node('c', null)]);

    expect(nodes.find((n) => n.id === 'a')?.hasChildren).toBe(true);
    expect(nodes.find((n) => n.id === 'b')?.hasChildren).toBe(false);
    expect(nodes.find((n) => n.id === 'c')?.hasChildren).toBe(false);
  });
});

describe('ArchiveMapper.toBreadcrumbs', () => {
  const index = new Map([
    ['root', node('root', null, '루트')],
    ['mid', node('mid', 'root', '중간')],
  ]);

  it('루트 → 부모 순서로 돌려주고 자기 자신은 넣지 않는다', () => {
    expect(ArchiveMapper.toBreadcrumbs({ parentId: 'mid' }, index).map((b) => b.title)).toEqual(['루트', '중간']);
  });

  it('부모가 없으면 빈 배열', () => {
    expect(ArchiveMapper.toBreadcrumbs({ parentId: null }, index)).toEqual([]);
  });

  it('부모 관계가 순환해도 멈춘다', () => {
    const cyclic = new Map([
      ['x', node('x', 'y')],
      ['y', node('y', 'x')],
    ]);

    expect(ArchiveMapper.toBreadcrumbs({ parentId: 'x' }, cyclic)).toHaveLength(2);
  });
});

describe('ArchiveMapper.toTrashItems', () => {
  it('삭제의 뿌리만 남기고 하위는 개수로 접는다', () => {
    const items = ArchiveMapper.toTrashItems([
      trashRow('parent', null),
      trashRow('child', 'parent'),
      trashRow('grandchild', 'child'),
      trashRow('other', null),
    ]);

    expect(items.map((i) => i.id)).toEqual(['parent', 'other']);
    expect(items.find((i) => i.id === 'parent')?.descendantCount).toBe(2);
    expect(items.find((i) => i.id === 'other')?.descendantCount).toBe(0);
  });

  it('부모는 살아 있고 자기만 지워진 페이지는 그 자체가 뿌리다', () => {
    const items = ArchiveMapper.toTrashItems([trashRow('lonely', 'alive-parent')]);

    expect(items.map((i) => i.id)).toEqual(['lonely']);
    expect(items[0].descendantCount).toBe(0);
  });
});
