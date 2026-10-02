import { barcodeWidthMm, PRINTER_MAX_WIDTH_MM, quietZoneMm, type BarcodePlacement } from './label-model';

const ITF: BarcodePlacement = {
  kind: 'ITF',
  data: '452716978431',
  xMm: 0,
  yMm: 0,
  heightMm: 10,
  moduleDots: 3,
  wideRatio: 2.5,
};
const CODE128: BarcodePlacement = { kind: 'CODE128', data: '150', xMm: 0, yMm: 0, heightMm: 8, moduleDots: 2 };

describe('barcodeWidthMm', () => {
  it('ITF: 넓은 막대는 프린터가 dot 단위로 올려 그린다 — 3dot × 2.5 = 7.5 → 8dot (zebrash 역렌더 실측)', () => {
    // start 4×3 + 12자리 × (좁은 3×3 + 넓은 2×8) + stop (8 + 2×3) = 12 + 300 + 14 = 326 dot = 40.75mm
    expect(barcodeWidthMm(ITF)).toBeCloseTo(40.75, 6);
  });
  it('ITF 비를 안 주면 2.5', () => {
    expect(barcodeWidthMm({ ...ITF, wideRatio: undefined })).toBeCloseTo(40.75, 6);
  });
  it('ITF 비가 dot 로 나눠떨어지면 올림이 없다 — 3dot × 3.0 = 9dot', () => {
    // 12 + 12 × (9 + 18) + (9 + 6) = 351 dot = 43.875mm
    expect(barcodeWidthMm({ ...ITF, wideRatio: 3 })).toBeCloseTo(43.875, 6);
  });
  it('CODE128: subset B 상한 (11 × (n + 2) + 13) 모듈', () => {
    // (11 × 5 + 13) × 2 / 8 = 17mm
    expect(barcodeWidthMm(CODE128)).toBe(17);
  });
});

describe('quietZoneMm', () => {
  it('모듈 × 10', () => {
    expect(quietZoneMm(ITF)).toBe(3.75);
    expect(quietZoneMm(CODE128)).toBe(2.5);
  });
});

it('프린터 최대 인쇄폭은 108mm', () => {
  expect(PRINTER_MAX_WIDTH_MM).toBe(108);
});
