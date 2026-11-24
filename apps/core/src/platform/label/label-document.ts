import { DOTS_PER_MM, mmToDots, type LabelSpec } from './label-model';
import type { SvgRasterizer } from './svg-rasterizer';
import { encodeZpl } from './zpl-encoder';

/**
 * 여러 쪽 라벨을 프린터로 보낼 한 문자열로 만든다(#913 품목 줄 스펙 §6). 쪽마다 ^XA…^XZ 하나 —
 * warehouse-app 은 이 문자열을 통째로 print_raw 하므로 쪽을 몰라도 된다. 매니저와 현장 키트가 같이 쓴다.
 */
export function encodeLabelPages(pages: readonly LabelSpec[], rasterizer: SvgRasterizer, compress: boolean): string {
  if (pages.length === 0) throw new Error('label has no pages');
  return pages
    .map((spec) =>
      encodeZpl(rasterizer.rasterize(spec.svg, mmToDots(spec.widthMm)), spec.barcodes, {
        compress,
        rotation: spec.rotation,
      }),
    )
    .join('\n');
}

/**
 * 라벨 묶음을 장수와 함께 한 문자열로 만든다(#1281). 쪽마다 ^XA…^XZ 하나, 장수는 ^PQ 로 낸다.
 * `encodeLabelPages` 와 달리 빈 입력은 던지지 않고 ''(그릴 것이 없음)를 돌려준다.
 */
export function encodeLabelRuns(
  runs: readonly { spec: LabelSpec; copies: number }[],
  rasterizer: SvgRasterizer,
  compress: boolean,
  dotsPerMm: number = DOTS_PER_MM,
  tearOff: boolean = false,
): string {
  return runs
    .map(({ spec, copies }) =>
      encodeZpl(rasterizer.rasterize(spec.svg, mmToDots(spec.widthMm, dotsPerMm)), spec.barcodes, {
        compress,
        rotation: spec.rotation,
        copies,
        dotsPerMm,
        tearOff,
      }),
    )
    .join('\n');
}
