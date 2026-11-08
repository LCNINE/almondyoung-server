import { tableMinWidth } from './table-min-width';

// 11-08 라이브: 상품명 열의 minWidth 200 이 셀 style 에만 들어가 효과가 없었다 — grid 표는 table-fixed 라 셀의 min-width 를
// 브라우저가 무시하고, 표가 컨테이너 폭(100%)에 맞춰 상품명 열을 한 글자 폭까지 눌렀다.
describe('tableMinWidth — 최소 폭을 표에 건다', () => {
  it('최소 폭 열이 있으면 표의 최소 폭 = 고정 폭 합 + 최소 폭 합 — 좁으면 표가 가로로 스크롤되고 그 열은 최소 폭을 지킨다', () => {
    expect(tableMinWidth([{ width: 48 }, { minWidth: 200 }, { width: 104 }, {}])).toBe(352);
  });

  it('최소 폭 열이 없으면 걸지 않는다 — 지금 표들의 배치가 그대로다', () => {
    expect(tableMinWidth([{ width: 48 }, { width: 104 }, {}, undefined])).toBeUndefined();
  });

  it('남은 폭을 채우는 열(fluid)은 더하지 않는다', () => {
    expect(tableMinWidth([{ minWidth: 200 }, { fluid: true, width: 999 }])).toBe(200);
  });
});
