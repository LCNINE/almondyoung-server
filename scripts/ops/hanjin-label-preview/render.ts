/**
 * 한진 운송장 미리보기·현장 키트(#913). 합성 데이터로 NS·NL·FS 세 형의 PNG 와 ZPL 을 만든다.
 * PNG 는 포털 샘플(https://developers.hanjin.com/printwbl 「운송장 출력 Sample」)과 나란히 놓고 위치를
 * 비교하는 용도(템플릿 방향, 빨간 테두리 = 바코드 자리), ZPL 은 창고 프린터로 보내는 용도(프린터 방향).
 * 창고에서 보내는 법은 같은 폴더 README.md.
 *
 *   npx tsx scripts/ops/hanjin-label-preview/render.ts <출력 디렉터리>
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';
import type { HanjinLabelData } from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data';
import {
  HANJIN_LABEL_TEMPLATES,
  HANJIN_LABEL_TYPES,
  type HanjinLabelType,
} from '../../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-templates';
import { encodeLabelPages } from '../../../apps/core/src/modules/fulfillment/waybill/label/label-document';
import {
  barcodeWidthMm,
  mmToDots,
  type LabelSpec,
} from '../../../apps/core/src/modules/fulfillment/waybill/label/label-model';
import {
  LABEL_FONT_FILES,
  resolveLabelFontDir,
  SvgRasterizer,
} from '../../../apps/core/src/modules/fulfillment/waybill/label/svg-rasterizer';

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
    terminalName: '중구',
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
  items: [{ name: '토익 Speaking 1권', quantity: 1 }],
  boxType: 'A',
  custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS',
  printedDate: '2026-09-27',
  boxIndex: 1,
  boxCount: 1,
};

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: npx tsx scripts/ops/hanjin-label-preview/render.ts <out-dir>');
mkdirSync(outDir, { recursive: true });

const fontDir = resolveLabelFontDir();
const rasterizer = new SvgRasterizer();

const SAMPLES: Array<[name: string, type: HanjinLabelType, data: HanjinLabelData]> = HANJIN_LABEL_TYPES.map(
  (type): [string, HanjinLabelType, HanjinLabelData] => [`hanjin-${type.toLowerCase()}-preview`, type, SAMPLE],
);

for (const [name, type, data] of SAMPLES) {
  const pages = HANJIN_LABEL_TEMPLATES[type](data);
  pages.forEach((spec, i) => {
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
    writeFileSync(join(outDir, `${name}${pages.length > 1 ? `-p${i + 1}` : ''}.png`), png);
  });

  writeFileSync(join(outDir, `${name}.zpl`), encodeLabelPages(pages, rasterizer, false));
  writeFileSync(join(outDir, `${name}.compressed.zpl`), encodeLabelPages(pages, rasterizer, true));
  const [first] = pages;
  console.log(
    `wrote ${outDir}/${name}.{png,zpl,compressed.zpl}  (${first.widthMm}×${first.heightMm}mm, rotation ${first.rotation}, ${pages.length} page(s))`,
  );
}
