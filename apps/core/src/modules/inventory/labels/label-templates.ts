import {
  barcodeWidthMm,
  DOTS_PER_MM,
  type BarcodePlacement,
  type LabelSpec,
} from '../../../platform/label/label-model';
import { planCode128 } from '../../../platform/label/code128';
import { svgDocument, text, wrapLines } from '../../../platform/label/svg-elements';
import { fitSizePt, fitText } from '../../../platform/label/svg-text';

/** 라벨을 못 그린 사유. NO_BARCODE·NOT_FOUND 는 호출하는 쪽(서비스)이 쓴다. */
export type LabelSkipReason = 'UNSUPPORTED_CODE' | 'NO_BARCODE' | 'BARCODE_TOO_WIDE' | 'NOT_FOUND';
export type SkuLabelSize = '30x10' | '50x30';
export type Rendered = { ok: true; spec: LabelSpec } | { ok: false; reason: LabelSkipReason };

/** 막대 폭 바닥(dot). 이보다 좁으면 스캐너가 못 읽는다. */
export const MIN_MODULE_DOTS = 2;
/** 바코드가 라벨 폭에서 비워 두는 몫(좌우 합, mm). */
const SIDE_MARGIN_MM = 2;

/**
 * 기준 모듈에서 시작해 바코드 폭이 (라벨 폭 − 2mm) 를 넘으면 1 dot 씩 줄인다.
 * 바닥(MIN_MODULE_DOTS)에서도 넘치거나 인코딩 불가면 null.
 */
export function fitModuleDots(data: string, maxWidthMm: number, baseDots: number): number | null {
  const plan = planCode128(data);
  if (!plan) return null;
  for (let dots = baseDots; dots >= MIN_MODULE_DOTS; dots--) {
    if ((plan.modules * dots) / DOTS_PER_MM <= maxWidthMm) return dots;
  }
  return null;
}

type Fitted = { ok: true; barcode: BarcodePlacement } | { ok: false; reason: LabelSkipReason };

/** 가로 가운데에 놓는 CODE128_OPTIMAL 바코드를 맞춘다. */
function fitBarcode(data: string, widthMm: number, baseDots: number, yMm: number, heightMm: number): Fitted {
  if (!planCode128(data)) return { ok: false, reason: 'UNSUPPORTED_CODE' };
  const moduleDots = fitModuleDots(data, widthMm - SIDE_MARGIN_MM, baseDots);
  if (moduleDots === null) return { ok: false, reason: 'BARCODE_TOO_WIDE' };
  const barcode: BarcodePlacement = { kind: 'CODE128_OPTIMAL', data, xMm: 0, yMm, heightMm, moduleDots };
  return { ok: true, barcode: { ...barcode, xMm: (widthMm - barcodeWidthMm(barcode)) / 2 } };
}

const LOCATION_W = 50;
const LOCATION_H = 30;

/** 로케이션 50×30 — 위에 코드 글자(크게), 아래에 바코드. 바코드 값은 코드 그대로다. */
export function renderLocationLabel(code: string): Rendered {
  const fitted = fitBarcode(code, LOCATION_W, 3, 17, 10);
  if (!fitted.ok) return fitted;
  const pt = fitSizePt(code, 46, 40, 14);
  const svg = svgDocument(LOCATION_W, LOCATION_H, [
    ['code', [text({ x: LOCATION_W / 2, y: 13.5, pt, bold: true, anchor: 'middle', text: code })]],
  ]);
  return {
    ok: true,
    spec: { widthMm: LOCATION_W, heightMm: LOCATION_H, rotation: 0, svg, barcodes: [fitted.barcode] },
  };
}

/** SKU 라벨. 30×10 은 바코드 위·이름 아래(숫자 없음), 50×30 은 이름 위·바코드와 숫자 아래. */
export function renderSkuLabel(size: SkuLabelSize, sku: { name: string; barcode: string }): Rendered {
  if (size === '30x10') {
    const fitted = fitBarcode(sku.barcode, 30, 2, 0.6, 5);
    if (!fitted.ok) return fitted;
    const lines = wrapLines(sku.name, 28, 5, 2);
    const els = lines.map((t, i) => text({ x: 15, y: 7.6 + i * 1.8, pt: 5, anchor: 'middle', text: t }));
    return {
      ok: true,
      spec: {
        widthMm: 30,
        heightMm: 10,
        rotation: 0,
        svg: svgDocument(30, 10, [['name', els]]),
        barcodes: [fitted.barcode],
      },
    };
  }
  const fitted = fitBarcode(sku.barcode, 50, 3, 11, 10);
  if (!fitted.ok) return fitted;
  const lines = wrapLines(sku.name, 46, 8, 2);
  const nameEls = lines.map((t, i) => text({ x: 25, y: 4.5 + i * 4, pt: 8, anchor: 'middle', text: t }));
  const digits = text({ x: 25, y: 26, pt: 9, anchor: 'middle', text: fitText(sku.barcode, 46, 9) });
  return {
    ok: true,
    spec: {
      widthMm: 50,
      heightMm: 30,
      rotation: 0,
      svg: svgDocument(50, 30, [
        ['name', nameEls],
        ['digits', [digits]],
      ]),
      barcodes: [fitted.barcode],
    },
  };
}
