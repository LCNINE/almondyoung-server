import { shouldShowFloatingCollapse } from './product-description-floating-collapse';

describe('shouldShowFloatingCollapse', () => {
  it('접힌 상태에서는 표시하지 않는다', () => {
    expect(
      shouldShowFloatingCollapse({
        open: false,
        contentVisible: true,
        triggerFullyVisible: false,
      })
    ).toBe(false);
  });

  it('펼쳐졌지만 본문이 화면 밖이면 표시하지 않는다', () => {
    expect(
      shouldShowFloatingCollapse({
        open: true,
        contentVisible: false,
        triggerFullyVisible: false,
      })
    ).toBe(false);
  });

  it('실제 접기 버튼이 화면에 완전히 보이면 표시하지 않는다', () => {
    expect(
      shouldShowFloatingCollapse({
        open: true,
        contentVisible: true,
        triggerFullyVisible: true,
      })
    ).toBe(false);
  });

  it('펼쳐지고 본문은 보이지만 접기 버튼이 화면 밖이면 표시한다', () => {
    expect(
      shouldShowFloatingCollapse({
        open: true,
        contentVisible: true,
        triggerFullyVisible: false,
      })
    ).toBe(true);
  });
});
