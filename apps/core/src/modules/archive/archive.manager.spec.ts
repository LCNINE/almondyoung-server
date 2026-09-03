import { BadRequestError } from '@app/shared';
import { ArchiveManager } from './archive.manager';
import type { ArchivePage, ArchivePageVersion } from './schema/archive.schema';

const NOW = new Date('2026-09-02T00:00:00.000Z');

function makePage(overrides: Partial<ArchivePage> = {}): ArchivePage {
  return {
    id: 'page-1',
    parentId: null,
    space: 'team',
    ownerId: null,
    title: '문서',
    icon: null,
    coverUrl: null,
    content: [],
    contentMarkdown: '',
    searchText: '',
    sortKey: 'a0',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    deletedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ArchivePage;
}

type Recorded = {
  updates: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
  deletes: number;
};

/** drizzle 체인을 흉내 낸다 — where 는 await 도 되고 .returning() 도 붙일 수 있어야 한다. */
function makeTx(recorded: Recorded, updateResult: ArchivePage, selectRows: unknown[] = []) {
  const settled = (rows: unknown[]) => {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
    promise.returning = () => Promise.resolve(rows);
    return promise;
  };

  return {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        recorded.inserts.push(values);
        const promise = settled([{ ...makePage(), ...values }]);
        return Object.assign(promise, { onConflictDoNothing: () => Promise.resolve([]) });
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        recorded.updates.push(values);
        return { where: () => settled([{ ...updateResult, ...values }]) };
      },
    }),
    delete: () => ({
      where: () => {
        recorded.deletes += 1;
        return Promise.resolve([]);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(selectRows) }),
        }),
      }),
    }),
  };
}

type ReaderStub = {
  findAccessibleOrThrow: jest.Mock;
  findByIdOrNull: jest.Mock;
  listSubtreeIds: jest.Mock;
  listSiblings: jest.Mock;
  latestVersion: jest.Mock;
  findVersionOrThrow: jest.Mock;
};

function makeManager(options: {
  page?: ArchivePage;
  parent?: ArchivePage;
  subtree?: string[];
  siblings?: Array<{ id: string; sortKey: string }>;
  latestVersion?: ArchivePageVersion | null;
  selectRows?: unknown[];
}) {
  const page = options.page ?? makePage();
  const recorded: Recorded = { updates: [], inserts: [], deletes: 0 };
  const tx = makeTx(recorded, page, options.selectRows ?? []);

  const reader: ReaderStub = {
    findAccessibleOrThrow: jest.fn(async (id: string) =>
      options.parent && id === options.parent.id ? options.parent : page,
    ),
    findByIdOrNull: jest.fn(async () => page),
    listSubtreeIds: jest.fn(async () => options.subtree ?? [page.id]),
    listSiblings: jest.fn(async () => options.siblings ?? []),
    latestVersion: jest.fn(async () => options.latestVersion ?? null),
    findVersionOrThrow: jest.fn(),
  };

  const db = { run: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  const manager = new ArchiveManager(db as never, reader as never);

  return { manager, reader, recorded, page };
}

describe('ArchiveManager.move', () => {
  it('자기 자신 밑으로는 못 옮긴다', async () => {
    const { manager } = makeManager({});
    await expect(manager.move('page-1', { parentId: 'page-1' }, 'user-1')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('자기 하위 페이지 밑으로는 못 옮긴다', async () => {
    const { manager } = makeManager({
      parent: makePage({ id: 'child-1', parentId: 'page-1' }),
      subtree: ['page-1', 'child-1'],
    });

    await expect(manager.move('page-1', { parentId: 'child-1' }, 'user-1')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('다른 스페이스로는 못 옮긴다', async () => {
    const { manager } = makeManager({
      parent: makePage({ id: 'private-1', space: 'private', ownerId: 'user-1' }),
      subtree: ['page-1'],
    });

    await expect(manager.move('page-1', { parentId: 'private-1' }, 'user-1')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('이동은 UPDATE 한 번이고, 두 이웃 사이의 키를 받는다', async () => {
    const { manager, recorded } = makeManager({
      siblings: [
        { id: 'sib-a', sortKey: 'a0' },
        { id: 'sib-b', sortKey: 'a1' },
      ],
    });

    await manager.move('page-1', { parentId: null, position: 1 }, 'user-1');

    // 형제 순번을 다시 매기지 않는다 — 쓰기는 옮긴 페이지 한 줄뿐이다.
    expect(recorded.updates).toHaveLength(1);
    const key = recorded.updates[0].sortKey as string;
    expect(key > 'a0').toBe(true);
    expect(key < 'a1').toBe(true);
  });

  it('맨 앞으로 옮기면 첫 형제보다 작은 키를 받는다', async () => {
    const { manager, recorded } = makeManager({
      siblings: [
        { id: 'sib-a', sortKey: 'a1' },
        { id: 'sib-b', sortKey: 'a2' },
      ],
    });

    await manager.move('page-1', { parentId: null, position: 0 }, 'user-1');

    expect((recorded.updates[0].sortKey as string) < 'a1').toBe(true);
  });

  it('position 을 안 주면 맨 뒤로 간다', async () => {
    const { manager, recorded } = makeManager({
      siblings: [
        { id: 'sib-a', sortKey: 'a0' },
        { id: 'sib-b', sortKey: 'a1' },
      ],
    });

    await manager.move('page-1', { parentId: null }, 'user-1');

    expect((recorded.updates[0].sortKey as string) > 'a1').toBe(true);
  });
});

describe('ArchiveManager.update', () => {
  it('본문 상한을 넘으면 저장하지 않는다', async () => {
    const { manager, recorded } = makeManager({});
    const huge = [{ content: [{ type: 'text', text: 'ㄱ'.repeat(1_200_000) }] }];

    await expect(manager.update('page-1', { content: huge }, 'user-1')).rejects.toBeInstanceOf(BadRequestError);
    expect(recorded.updates).toHaveLength(0);
  });

  it('검색용 평문을 본문에서 직접 만든다 — 클라이언트가 준 값을 쓰지 않는다', async () => {
    const { manager, recorded } = makeManager({});

    await manager.update(
      'page-1',
      { content: [{ content: [{ type: 'text', text: '입고 마감' }] }], contentMarkdown: '엉뚱한 값' },
      'user-1',
    );

    const patch = recorded.updates.at(-1);
    expect(patch?.searchText).toBe('입고 마감');
    expect(patch?.contentMarkdown).toBe('엉뚱한 값');
  });

  it('같은 사람이 짧은 간격으로 이어 쓰면 스냅샷을 새로 만들지 않는다', async () => {
    const { manager, recorded } = makeManager({
      latestVersion: { authorId: 'user-1', createdAt: new Date(Date.now() - 60_000) } as ArchivePageVersion,
    });

    await manager.update('page-1', { content: [] }, 'user-1');

    expect(recorded.inserts).toHaveLength(0);
  });

  it('다른 사람이 이어 쓰면 직전 상태를 스냅샷으로 남긴다', async () => {
    const { manager, recorded } = makeManager({
      latestVersion: { authorId: 'user-2', createdAt: new Date(Date.now() - 60_000) } as ArchivePageVersion,
    });

    await manager.update('page-1', { content: [] }, 'user-1');

    expect(recorded.inserts).toHaveLength(1);
    expect(recorded.inserts[0]).toMatchObject({ pageId: 'page-1', authorId: 'user-1' });
  });

  it('본문도 제목도 안 바뀌면 스냅샷을 남기지 않는다', async () => {
    const { manager, recorded } = makeManager({});

    await manager.update('page-1', { icon: '📌' }, 'user-1');

    expect(recorded.inserts).toHaveLength(0);
  });
});

describe('ArchiveManager.restore', () => {
  it('부모가 아직 휴지통이면 스페이스 루트로 올린다', async () => {
    const deleted = makePage({ parentId: 'gone-parent', deletedAt: NOW });
    const { manager, recorded, reader } = makeManager({ page: deleted });
    reader.findByIdOrNull.mockResolvedValue(makePage({ id: 'gone-parent', deletedAt: NOW }));

    await manager.restore('page-1', 'user-1');

    const patch = recorded.updates.at(-1);
    expect(patch).toMatchObject({ parentId: null });
    // 갈 곳이 없어 루트로 올릴 때만 새 키를 받는다.
    expect(typeof patch?.sortKey).toBe('string');
  });

  it('부모가 멀쩡하면 원래 자리로 돌아간다 — 정렬 키를 새로 주지 않는다', async () => {
    const deleted = makePage({ parentId: 'alive-parent', sortKey: 'a0', deletedAt: NOW });
    const { manager, recorded, reader } = makeManager({ page: deleted });
    reader.findByIdOrNull.mockResolvedValue(makePage({ id: 'alive-parent', deletedAt: null }));

    await manager.restore('page-1', 'user-1');

    const patch = recorded.updates.at(-1);
    expect(patch).not.toHaveProperty('sortKey');
    expect(patch).not.toHaveProperty('parentId');
  });

  it('루트 페이지를 되돌려도 정렬 키를 새로 주지 않는다', async () => {
    const deleted = makePage({ parentId: null, sortKey: 'a0', deletedAt: NOW });
    const { manager, recorded } = makeManager({ page: deleted });

    await manager.restore('page-1', 'user-1');

    expect(recorded.updates.at(-1)).not.toHaveProperty('sortKey');
  });

  it('이미 살아 있는 페이지는 아무것도 바꾸지 않는다', async () => {
    const { manager, recorded } = makeManager({ page: makePage({ deletedAt: null }) });

    await manager.restore('page-1', 'user-1');

    expect(recorded.updates).toHaveLength(0);
  });
});

describe('ArchiveManager.purge', () => {
  it('휴지통에 없는 페이지는 영구 삭제할 수 없다', async () => {
    const { manager, recorded } = makeManager({ page: makePage({ deletedAt: null }) });

    await expect(manager.purge('page-1', 'user-1')).rejects.toBeInstanceOf(BadRequestError);
    expect(recorded.deletes).toBe(0);
  });

  it('휴지통에 있으면 본문·스냅샷·즐겨찾기를 함께 지운다', async () => {
    const { manager, recorded } = makeManager({ page: makePage({ deletedAt: NOW }) });

    await manager.purge('page-1', 'user-1');

    expect(recorded.deletes).toBe(3);
  });
});
