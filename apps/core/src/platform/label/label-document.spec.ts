import type { LabelSpec } from './label-model';
import { SvgRasterizer } from './svg-rasterizer';
import { encodeLabelPages } from './label-document';

const page = (w: number): LabelSpec => ({
  widthMm: w,
  heightMm: 10,
  rotation: 0,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="10mm" viewBox="0 0 ${w} 10"></svg>`,
  barcodes: [],
});

describe('encodeLabelPages', () => {
  const rasterizer = new SvgRasterizer();

  it('쪽마다 ^XA…^XZ 하나를 순서대로 이어 붙인다', () => {
    const data = encodeLabelPages([page(10), page(20)], rasterizer, false);
    expect(data.match(/\^XA/g)).toHaveLength(2);
    expect(data.match(/\^XZ/g)).toHaveLength(2);
    expect(data.indexOf('^PW80')).toBeLessThan(data.indexOf('^PW160')); // 10mm·20mm = 80·160 dot
  });

  it('한 쪽이면 encodeZpl 한 번과 같다(^XA 하나)', () => {
    expect(encodeLabelPages([page(10)], rasterizer, true).match(/\^XA/g)).toHaveLength(1);
  });

  it('쪽이 없으면 던진다', () => {
    expect(() => encodeLabelPages([], rasterizer, false)).toThrow(/no pages/);
  });
});
