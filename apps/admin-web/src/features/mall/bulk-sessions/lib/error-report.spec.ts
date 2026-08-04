import { formatErrorReport } from './error-report';
import type { BulkSessionItem } from '@/lib/types/dto/bulk-session';

function item(over: Partial<BulkSessionItem>): BulkSessionItem {
  return {
    id: 'i1', rowNumber: 2, rowKey: 'P-000001', kind: 'update', productName: '티셔츠',
    status: 'invalid', masterId: null, errorMessage: null, draftVersionId: null,
    publishStatus: 'idle', publishError: null, changes: [], conflicts: [],
    ...over,
  };
}

describe('formatErrorReport', () => {
  it('행마다 행번호·상품키·상품명·사유를 한 줄로 낸다', () => {
    const text = formatErrorReport([
      item({ rowNumber: 3, rowKey: 'P-000007', productName: '니트', errorMessage: '[카테고리] 경로를 찾을 수 없습니다: 여성>없음' }),
    ]);

    expect(text).toContain('3행');
    expect(text).toContain('P-000007');
    expect(text).toContain('니트');
    expect(text).toContain('경로를 찾을 수 없습니다');
  });

  it('상품명이 비면 대체 표시를 쓴다 — 행이 망가져 이름을 못 뽑는 경우가 있다', () => {
    expect(formatErrorReport([item({ productName: '' })])).toContain('(이름 없음)');
  });

  it('사유가 없으면 그렇게 적는다 — 빈 줄을 남기지 않는다', () => {
    expect(formatErrorReport([item({ errorMessage: null })])).toContain('(사유 없음)');
  });

  it('머리말에 건수를 실어 붙여넣은 쪽이 전량인지 알 수 있게 한다', () => {
    const text = formatErrorReport([item({}), item({ id: 'i2' })]);
    expect(text.split('\n')[0]).toContain('2건');
  });

  it('빈 목록이면 그렇게 말한다', () => {
    expect(formatErrorReport([])).toContain('오류 행이 없습니다');
  });
});
