import { activeReviewTab, nextReviewTabParams } from './review-tabs';

describe('review tabs', () => {
  it('sourceSystem=admin-manual 이면 수기 작성 탭이 활성이다', () => {
    expect(activeReviewTab(new URLSearchParams('sourceSystem=admin-manual'))).toBe('admin-manual');
    expect(activeReviewTab(new URLSearchParams('provider=order'))).toBe('order');
    expect(activeReviewTab(new URLSearchParams(''))).toBe('');
  });

  it('수기 작성 탭으로 가면 권한·배치·페이지 필터를 비운다', () => {
    const next = nextReviewTabParams(new URLSearchParams('provider=admin&batchId=b1&page=3&q=향'), 'admin-manual');
    expect(next.get('sourceSystem')).toBe('admin-manual');
    expect(next.get('provider')).toBeNull();
    expect(next.get('batchId')).toBeNull();
    expect(next.get('page')).toBeNull();
    expect(next.get('q')).toBe('향');
  });

  it('권한 탭으로 가면 출처 필터를 비운다', () => {
    const next = nextReviewTabParams(new URLSearchParams('sourceSystem=admin-manual'), 'order');
    expect(next.get('provider')).toBe('order');
    expect(next.get('sourceSystem')).toBeNull();
  });

  it('전체 탭은 둘 다 비운다', () => {
    const next = nextReviewTabParams(new URLSearchParams('provider=admin&sourceSystem=admin-manual'), '');
    expect(next.get('provider')).toBeNull();
    expect(next.get('sourceSystem')).toBeNull();
  });
});
