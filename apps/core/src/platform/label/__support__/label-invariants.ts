import { barcodeWidthMm, DOTS_PER_MM, getBit, quietZoneMm, type BarcodeKind, type LabelSpec } from '../label-model';
import { SvgRasterizer } from '../svg-rasterizer';

/** 바코드 상자 + 좌우 quiet zone (mm, 템플릿 방향). 이 안에 다른 잉크가 있으면 스캐너가 못 읽을 수 있다. */
export interface KeepOut {
  kind: BarcodeKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function barcodeKeepOutsMm(spec: LabelSpec): KeepOut[] {
  return spec.barcodes.map((b) => {
    const qz = quietZoneMm(b);
    return { kind: b.kind, x0: b.xMm - qz, x1: b.xMm + barcodeWidthMm(b) + qz, y0: b.yMm, y1: b.yMm + b.heightMm };
  });
}

const rasterizer = new SvgRasterizer();

/** 인쇄되는 비트맵과 같은 경로로 svg 를 그려, 각 바코드 금지 구역 안의 검은 점 수를 센다. */
export function inkInBarcodeKeepOuts(spec: LabelSpec): Array<{ kind: BarcodeKind; ink: number }> {
  const bmp = rasterizer.rasterize(spec.svg, Math.round(spec.widthMm * DOTS_PER_MM));
  return barcodeKeepOutsMm(spec).map((z) => {
    const x0 = Math.max(0, Math.floor(z.x0 * DOTS_PER_MM));
    const x1 = Math.min(bmp.widthDots, Math.ceil(z.x1 * DOTS_PER_MM));
    const y0 = Math.max(0, Math.floor(z.y0 * DOTS_PER_MM));
    const y1 = Math.min(bmp.heightDots, Math.ceil(z.y1 * DOTS_PER_MM));
    let ink = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (getBit(bmp, x, y)) ink++;
    return { kind: z.kind, ink };
  });
}
