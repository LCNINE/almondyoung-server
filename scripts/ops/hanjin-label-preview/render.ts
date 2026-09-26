/**
 * 한진 NS 라벨 미리보기(#913). 합성 데이터로 PNG 와 ZPL 을 만든다 — 포털 샘플
 * (https://developers.hanjin.com/files/ns_new.jpg)과 나란히 놓고 위치를 비교하는 용도.
 * 창고 프린터 실물 출력(스펙 §10-3)에는 같이 나오는 .zpl 을 쓴다.
 *
 *   npx tsx scripts/ops/hanjin-label-preview/render.ts <출력 디렉터리>
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';
import { renderHanjinNsLabel } from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-ns-template';
import type { HanjinLabelData } from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data';
import {
  mmToDots,
  type BarcodePlacement,
  type LabelSpec,
} from '../../../apps/core/src/modules/fulfillment/waybill/label/label-model';
import {
  LABEL_FONT_FILES,
  resolveLabelFontDir,
  SvgRasterizer,
} from '../../../apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer';
import { encodeZpl } from '../../../apps/core/src/modules/fulfillment/waybill/label/zpl-encoder';

/**
 * 바코드 실제 인쇄 폭(mm) 근사 — 미리보기 PNG 에 위치 확인용 테두리를 그리기 위해서만 쓴다.
 * ZPL 출력에는 영향 없음(ZPL 은 프린터가 `^B2`/`^BC` 로 직접 그린다).
 *
 * ITF(Interleaved 2 of 5): start(narrow 4모듈) + 자릿수×(좁은 3모듈 + 넓은 2모듈×ratio) + stop(ratio+2모듈).
 * CODE128 은 가변 인코딩이라 정확한 폭 계산 대신 필드표(ns2) 실측값 25mm 를 그대로 쓴다.
 */
function barcodeWidthMm(b: BarcodePlacement): number {
  if (b.kind === 'CODE128') return 25;
  const ratio = b.wideRatio ?? 2.5;
  return ((4 + b.data.length * (3 + 2 * ratio) + (ratio + 2)) * b.moduleDots) / 8;
}

/** PNG 미리보기 전용 — spec.svg 에 바코드 위치 테두리(빨간 사각형)를 얹는다. ZPL 은 원본 svg 를 그대로 쓴다. */
function withBarcodeOverlay(spec: LabelSpec): string {
  const rects = spec.barcodes
    .map((b) => {
      const w = barcodeWidthMm(b).toFixed(2);
      return `<rect x="${b.xMm}" y="${b.yMm}" width="${w}" height="${b.heightMm}" fill="none" stroke="red" stroke-width="0.5"/>`;
    })
    .join('');
  return spec.svg.replace('</svg>', `${rects}</svg>`);
}

const SAMPLE: HanjinLabelData = {
  trackingNo: '452716978431',
  trackingNoDisplay: '4527-1697-8431',
  sort: {
    hubCode: 'NX',
    terminalCode: '150',
    midCode: 'Z',
    centerCode: '1050',
    centerName: '해운(집)',
    originTerminalCode: '000',
    originTerminalName: '본사',
    routeRank: 'A1',
    courierName: '권순천',
    courierSortCode: '888',
    addressSummary: '소공동 51 한진빌딩',
  },
  regionText: '수도권',
  freightText: '발지신용',
  recipient: {
    name: '홍길동',
    phone: '010-0000-0000',
    baseAddress: '서울특별시 중구 소공로 88',
    detailAddress: '테스트 주소2',
  },
  sender: { name: '아몬드영', phone: '010-0000-1111', baseAddress: '서울특별시 종로구 사직로 161' },
  deliveryMessage: '특이사항 없습니다.',
  commodityName: '토익 Speaking 1권',
  boxType: 'A',
  custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS',
  printedDate: '2026-09-27',
  boxIndex: 1,
  boxCount: 1,
};

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: npx tsx scripts/ops/hanjin-label-preview/render.ts <out-dir>');
mkdirSync(outDir, { recursive: true });

const spec = renderHanjinNsLabel(SAMPLE);
const fontDir = resolveLabelFontDir();
const png = new Resvg(withBarcodeOverlay(spec), {
  background: 'white',
  fitTo: { mode: 'width', value: mmToDots(spec.widthMm) },
  font: {
    loadSystemFonts: false,
    fontFiles: LABEL_FONT_FILES.map((f) => join(fontDir, f)),
    defaultFontFamily: 'NanumGothic',
  },
})
  .render()
  .asPng();
writeFileSync(join(outDir, 'hanjin-ns-preview.png'), png);

const bitmap = new SvgRasterizer().rasterize(spec.svg, mmToDots(spec.widthMm));
writeFileSync(join(outDir, 'hanjin-ns-preview.zpl'), encodeZpl(bitmap, spec.barcodes, { compress: false }));
writeFileSync(join(outDir, 'hanjin-ns-preview.compressed.zpl'), encodeZpl(bitmap, spec.barcodes, { compress: true }));
console.log(`wrote ${outDir}/hanjin-ns-preview.{png,zpl,compressed.zpl}`);
