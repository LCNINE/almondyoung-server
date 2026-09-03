import { QueryClient } from '@tanstack/react-query';
import { writeBackSavedPage } from './mutations';
import { archiveQueryKeys } from './query-keys';
import type {
  ArchivePageDetailDto,
  ArchivePageSaveResultDto,
} from '@/lib/types/dto/archive';

const PAGE_ID = 'page-1';

function detail(
  overrides: Partial<ArchivePageDetailDto> = {}
): ArchivePageDetailDto {
  return {
    id: PAGE_ID,
    parentId: null,
    space: 'team',
    title: '옛 제목',
    icon: null,
    coverUrl: null,
    content: [],
    contentMarkdown: '',
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    isFavorite: false,
    breadcrumbs: [],
    ...overrides,
  };
}

function saveResult(): ArchivePageSaveResultDto {
  return {
    id: PAGE_ID,
    title: '새 제목',
    icon: '📄',
    coverUrl: null,
    updatedBy: 'user-1',
    updatedAt: '2026-09-03T05:00:00.000Z',
  };
}

function makeClient(seed?: ArchivePageDetailDto) {
  const queryClient = new QueryClient();
  if (seed) queryClient.setQueryData(archiveQueryKeys.page(PAGE_ID), seed);
  return queryClient;
}

describe('writeBackSavedPage', () => {
  it('본문 저장분을 캐시에 넣는다 — 안 넣으면 돌아왔을 때 빈 문서가 뜨고 그게 서버를 덮는다', () => {
    const queryClient = makeClient(detail());
    const content = [{ id: 'b1', type: 'paragraph' }];

    writeBackSavedPage(
      queryClient,
      PAGE_ID,
      { content, contentMarkdown: '안녕' },
      saveResult()
    );

    const cached = queryClient.getQueryData<ArchivePageDetailDto>(
      archiveQueryKeys.page(PAGE_ID)
    );
    expect(cached?.content).toEqual(content);
    expect(cached?.contentMarkdown).toBe('안녕');
  });

  it('제목만 저장한 요청은 본문을 건드리지 않는다', () => {
    const content = [{ id: 'b1', type: 'paragraph' }];
    const queryClient = makeClient(
      detail({ content, contentMarkdown: '원래 본문' })
    );

    writeBackSavedPage(queryClient, PAGE_ID, { title: '새 제목' }, saveResult());

    const cached = queryClient.getQueryData<ArchivePageDetailDto>(
      archiveQueryKeys.page(PAGE_ID)
    );
    expect(cached?.content).toEqual(content);
    expect(cached?.contentMarkdown).toBe('원래 본문');
    expect(cached?.title).toBe('새 제목');
  });

  it('캐시에 없는 페이지는 만들어 내지 않는다 — 부분 문서가 진짜 문서 행세를 하면 안 된다', () => {
    const queryClient = makeClient();

    writeBackSavedPage(
      queryClient,
      PAGE_ID,
      { content: [], contentMarkdown: '' },
      saveResult()
    );

    expect(
      queryClient.getQueryData(archiveQueryKeys.page(PAGE_ID))
    ).toBeUndefined();
  });
});
