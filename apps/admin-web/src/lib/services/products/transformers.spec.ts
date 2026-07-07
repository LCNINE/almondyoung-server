import { fromServerScalePercent, toServerScalePercent } from './transformers';

// 가격 룰 'scale'(비율) 연산은 UI에서 백분율(%)로 입력한다.
// 서버는 배율을 ×1000 fixed-point 정수로 저장하며, 계산식은
//   새가격 = 현재가격 × (1000 + serverValue) / 1000
// 이다. 따라서 UI 백분율 p% ↔ 서버 정수 p*10 이어야 한다.
//   예) -50(%) → -500  ⇒  현재가격의 절반을 차감(×0.5)
describe('scale percent <-> server fixed-point conversion', () => {
  describe('toServerScalePercent', () => {
    it('-50% 입력은 서버 -500 으로 보낸다 (전체 가격의 절반 차감)', () => {
      expect(toServerScalePercent(-50)).toBe(-500);
    });

    it('+50% 입력은 서버 500 으로 보낸다 (×1.5)', () => {
      expect(toServerScalePercent(50)).toBe(500);
    });

    it('0% 입력은 서버 0 (변화 없음)', () => {
      expect(toServerScalePercent(0)).toBe(0);
    });

    it('-100% 는 서버 -1000 (0원, 하한)', () => {
      expect(toServerScalePercent(-100)).toBe(-1000);
    });

    it('+100% 는 서버 1000 (×2)', () => {
      expect(toServerScalePercent(100)).toBe(1000);
    });

    it('소수 백분율은 0.1% 단위 정수로 반올림한다', () => {
      expect(toServerScalePercent(-50.5)).toBe(-505);
      expect(toServerScalePercent(12.34)).toBe(123);
    });
  });

  describe('fromServerScalePercent', () => {
    it('서버 -500 은 -50(%) 로 표시한다', () => {
      expect(fromServerScalePercent(-500)).toBe(-50);
    });

    it('서버 1000 은 100(%) 로 표시한다', () => {
      expect(fromServerScalePercent(1000)).toBe(100);
    });

    it('서버 0 은 0(%)', () => {
      expect(fromServerScalePercent(0)).toBe(0);
    });
  });

  it('정수 백분율은 왕복 변환이 보존된다', () => {
    for (const p of [-100, -50, -1, 0, 1, 25, 100, 250]) {
      expect(fromServerScalePercent(toServerScalePercent(p))).toBe(p);
    }
  });
});
