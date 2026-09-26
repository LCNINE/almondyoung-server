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
import { mmToDots } from '../../../apps/core/src/modules/fulfillment/waybill/label/label-model';
import {
  LABEL_FONT_FILES,
  resolveLabelFontDir,
  SvgRasterizer,
} from '../../../apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer';
import { encodeZpl } from '../../../apps/core/src/modules/fulfillment/waybill/label/zpl-encoder';

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
const png = new Resvg(spec.svg, {
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
