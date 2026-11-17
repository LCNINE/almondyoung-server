import { memoPreview } from './memo-preview';

describe('memoPreview', () => {
  it('shows the first non-empty line', () => {
    expect(memoPreview('\n  결품 안내 완료  \n포인트 전환 예정')).toBe(
      '결품 안내 완료'
    );
    expect(memoPreview('한 줄 메모')).toBe('한 줄 메모');
  });

  it('treats a missing or blank memo as no memo', () => {
    expect(memoPreview(undefined)).toBeNull();
    expect(memoPreview(null)).toBeNull();
    expect(memoPreview('')).toBeNull();
    expect(memoPreview(' \r\n ')).toBeNull();
  });
});
