import { isPageChanging } from './paging-state';

describe('isPageChanging', () => {
  it('placeholder 가 떠 있으면 옛 페이지를 보고 있는 것이다 — 이때 isLoading 은 false 다', () => {
    expect(isPageChanging({ isPlaceholderData: true, isFetching: true, isLoading: false })).toBe(true);
  });

  it('재요청 중이면 placeholder 플래그가 없어도 표시한다', () => {
    expect(isPageChanging({ isPlaceholderData: false, isFetching: true, isLoading: false })).toBe(true);
  });

  it('첫 로딩은 스켈레톤이 담당하므로 여기서는 false', () => {
    expect(isPageChanging({ isPlaceholderData: false, isFetching: true, isLoading: true })).toBe(false);
  });

  it('다 끝났으면 false', () => {
    expect(isPageChanging({ isPlaceholderData: false, isFetching: false, isLoading: false })).toBe(false);
  });

  it('플래그가 안 들어와도 터지지 않는다', () => {
    expect(isPageChanging({})).toBe(false);
  });
});
