// 서버는 배율을 ×1000 fixed-point 정수로 저장하고,
//   새가격 = 현재가격 × (1000 + serverValue) / 1000
// 로 계산한다. UI는 이를 백분율(%)로 입력/표시한다.
//   예) UI -50(%) ↔ 서버 -500  ⇒  현재가격의 절반 차감(×0.5)
//       UI 100(%) ↔ 서버 1000  ⇒  ×2
// 하한은 서버 -1000 (= UI -100%, 0원)이며 상한은 없다.

export const fromServerScalePercent = (serverValue: number): number =>
  serverValue / 10;

export const toServerScalePercent = (uiPercent: number): number =>
  Math.round(uiPercent * 10);
