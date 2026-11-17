import { mmToDots, type LabelSpec } from './label-model';
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
