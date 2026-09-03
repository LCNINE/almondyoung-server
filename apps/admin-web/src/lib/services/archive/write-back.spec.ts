import { mergeSavedPage } from './write-back';
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

describe('mergeSavedPage', () => {
  it('본문 저장분을 캐시 항목에 넣는다 — 안 넣으면 돌아왔을 때 빈 문서가 뜨고 그게 서버를 덮는다', () => {
    const content = [{ id: 'b1', type: 'paragraph' }];

    const merged = mergeSavedPage(
      detail(),
      { content, contentMarkdown: '안녕' },
      saveResult()
    );

    expect(merged?.content).toEqual(content);
    expect(merged?.contentMarkdown).toBe('안녕');
  });

  it('제목만 저장한 요청은 본문을 건드리지 않는다', () => {
    const content = [{ id: 'b1', type: 'paragraph' }];

    const merged = mergeSavedPage(
      detail({ content, contentMarkdown: '원래 본문' }),
      { title: '새 제목' },
      saveResult()
    );

    expect(merged?.content).toEqual(content);
    expect(merged?.contentMarkdown).toBe('원래 본문');
    expect(merged?.title).toBe('새 제목');
  });

  it('캐시에 없는 페이지는 만들어 내지 않는다 — 부분 문서가 진짜 문서 행세를 하면 안 된다', () => {
    const merged = mergeSavedPage(
      undefined,
      { content: [], contentMarkdown: '' },
      saveResult()
    );

    expect(merged).toBeUndefined();
  });

  it('저장 결과가 없으면 옛 항목을 그대로 두고 보낸 것만 얹는다', () => {
    const merged = mergeSavedPage(detail({ contentMarkdown: '원래 본문' }), {
      contentMarkdown: '새 본문',
    });

    expect(merged?.title).toBe('옛 제목');
    expect(merged?.updatedAt).toBe('2026-09-03T00:00:00.000Z');
    expect(merged?.contentMarkdown).toBe('새 본문');
  });
});
