import { join } from 'path';
import { getBit } from './label-model';
import { resolveLabelFontDir, SvgRasterizer } from './svg-rasterizer';

const svgOf = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="5mm" viewBox="0 0 10 5" font-family="NanumGothic">${body}</svg>`;

const blackCount = (b: { widthDots: number; heightDots: number }, has: (x: number, y: number) => boolean) => {
  let n = 0;
  for (let y = 0; y < b.heightDots; y++) for (let x = 0; x < b.widthDots; x++) if (has(x, y)) n++;
  return n;
};

describe('SvgRasterizer', () => {
  const r = new SvgRasterizer();

  it('요청한 폭(dot)으로 그리고 높이는 viewBox 비율을 따른다', () => {
    const b = r.rasterize(svgOf(''), 80);
    expect([b.widthDots, b.heightDots, b.bytesPerRow]).toEqual([80, 40, 10]);
  });

  it('검은 사각형은 1, 빈 곳은 0 이다', () => {
    const b = r.rasterize(svgOf('<rect x="0" y="0" width="5" height="5" fill="#000"/>'), 80);
    expect(getBit(b, 10, 20)).toBe(true);
    expect(getBit(b, 70, 20)).toBe(false);
  });

  it('번들 나눔고딕으로 한글을 그린다 — 굵게는 더 많이 칠한다', () => {
    const regular = r.rasterize(svgOf('<text x="0" y="4" font-size="3.5">한진</text>'), 80);
    const bold = r.rasterize(svgOf('<text x="0" y="4" font-size="3.5" font-weight="700">한진</text>'), 80);
    const n = blackCount(regular, (x, y) => getBit(regular, x, y));
    const nb = blackCount(bold, (x, y) => getBit(bold, x, y));
    expect(n).toBeGreaterThan(0);
    expect(nb).toBeGreaterThan(n);
  });

  it('폰트에 없는 글자(이모지)는 비워 두고 던지지 않는다', () => {
    expect(() => r.rasterize(svgOf('<text x="0" y="4" font-size="3.5">문앞😀</text>'), 80)).not.toThrow();
  });

  it('폰트가 없으면 찾아본 경로를 담아 던진다', () => {
    const missing = new SvgRasterizer(() => resolveLabelFontDir('/nonexistent-root'));
    expect(() => missing.rasterize(svgOf(''), 80)).toThrow(/nonexistent-root\/dist\/apps\/core\/assets\/fonts/);
  });
});

describe('resolveLabelFontDir', () => {
  it('빌드 산출물(dist)을 먼저 본다', () => {
    const exists = (p: string) => p.startsWith('/app/dist/');
    expect(resolveLabelFontDir('/app', exists)).toBe(join('/app', 'dist/apps/core/assets/fonts'));
  });

  it('dist 에 없으면 소스 경로를 쓴다(개발 모드·jest)', () => {
    const exists = (p: string) => p.startsWith('/repo/apps/');
    expect(resolveLabelFontDir('/repo', exists)).toBe(join('/repo', 'apps/core/assets/fonts'));
  });

  it('폰트 파일 하나라도 빠진 후보는 건너뛴다', () => {
    const exists = (p: string) =>
      p.startsWith('/r/apps/') || p.endsWith('/dist/apps/core/assets/fonts/NanumGothic-Regular.ttf');
    expect(resolveLabelFontDir('/r', exists)).toBe(join('/r', 'apps/core/assets/fonts'));
  });
});
