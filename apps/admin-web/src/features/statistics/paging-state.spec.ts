import { isPageChanging } from './paging-state';

describe('isPageChanging', () => {
  it('placeholder 가 떠 있으면 옛 페이지를 보고 있는 것이다 — 이때 isLoading 은 false 다', () => {
    expect(isPageChanging({ isPlaceholderData: true, isFetching: true, isLoading: false })).toBe(true);
  });

  it('같은 페이지를 다시 확인하는 재요청은 옛 페이지가 아니다 — 흐리게 하거나 잠그지 않는다', () => {
    expect(isPageChanging({ isPlaceholderData: false, isFetching: true, isLoading: false })).toBe(false);
  });

  it('첫 로딩은 스켈레톤이 담당하므로 여기서는 false', () => {
    expect(isPageChanging({ isPlaceholderData: false, isFetching: true, isLoading: true })).toBe(false);
  });

  it('응답이 도착하면 재요청이 남아 있어도 false', () => {
    expect(isPageChanging({ isPlaceholderData: false, isFetching: false, isLoading: false })).toBe(false);
  });

  it('플래그가 안 들어와도 터지지 않는다', () => {
    expect(isPageChanging({})).toBe(false);
  });
});
