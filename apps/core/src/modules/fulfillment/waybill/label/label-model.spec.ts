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
  it('ITF: start 4 + 자릿수 × (3 + 2×비) + stop (비+2) 모듈', () => {
    // (4 + 12 × 8 + 4.5) × 3 dot / 8 = 39.1875mm
    expect(barcodeWidthMm(ITF)).toBeCloseTo(39.1875, 6);
  });
  it('ITF 비를 안 주면 2.5', () => {
    expect(barcodeWidthMm({ ...ITF, wideRatio: undefined })).toBeCloseTo(39.1875, 6);
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
