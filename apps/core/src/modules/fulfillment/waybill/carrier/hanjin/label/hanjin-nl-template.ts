import { DOTS_PER_MM, type BarcodePlacement, type LabelSpec } from '../../../label/label-model';
import { fitSizePt, fitText } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';
import { koreanDate, rect, shrinkThenFit, svgDocument, text } from './hanjin-label-svg';

/**
 * 한진 NL형(가로 100 × 세로 102mm) 자체출력 운송장(#913).
 *
 * 폭이 100mm 라 프린터(인쇄폭 108mm)에 돌리지 않고 넣는다. 세로 102mm 는 포털에 없어 샘플 외곽 비율로
 * 잡았다(2026-09-28 결정 — 현장 실측이 다르면 HEIGHT_MM 하나만 고친다).
 *
 * **검은색 요소만** 그린다 — 테두리·캡션(「배달표」「받는분」「특기사항」「내품명」「운송장번호」)·로고·
 * 「GENERAL」 은 라벨지에 선인쇄. 좌표는 포털 NL 샘플(nl_new.jpg) 실측 mm, y 는 기준선, 글자 크기는
 * 필드표(nl2.jpg)의 pt. ④⑯ 은 표 크기(35)로는 우리 폰트 폭이 칸을 넘어 칸에 맞춰 줄인다.
 *
 * 면별 마스킹(정본 §3.3):
 *   배달표(위) — 받는분 성명·연락처 마스킹 + 주소 원본 / 보낸분 성명·연락처 원본 + 주소 마스킹
 *   받는고객용(아래, 배달표 외) — 받는분은 ⑫ 약칭주소만 / 보낸분 전부 마스킹
 */

const WIDTH_MM = 100;
const HEIGHT_MM = 102;

const ITF_MODULE_DOTS = 3;
export const NL_ITF_X_MM = 56;
export const NL_ITF_QUIET_ZONE_MM = (10 * ITF_MODULE_DOTS) / DOTS_PER_MM;

/** 출고번호 줄은 ITF 와 같은 높이라 quiet zone 앞에서 멈춘다. 식별자라 자르지 않고 최소 4pt 까지 줄인다. */
export const NL_CUST_ORD_NO_X_MM = 5.1;
export const NL_CUST_ORD_NO_MAX_WIDTH_MM = NL_ITF_X_MM - NL_ITF_QUIET_ZONE_MM - NL_CUST_ORD_NO_X_MM;

export function renderHanjinNlLabel(d: HanjinLabelData): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const sd = d.sender;

  const slipAddress = shrinkThenFit(`${rc.baseAddress} ${rc.detailAddress}`, 89.5, 9); // 배달표 받는분 주소(원본)
  const message = shrinkThenFit(d.deliveryMessage, 84, 9); // ⑭
  const custText = `출고번호: ${d.custOrdNo}`;

  // ── 분류 머리 ───────────────────────────────────────────────────────────
  const sortHead = [
    text({ x: 3.5, y: 14.7, pt: 35, bold: true, text: s.hubCode }), // ①
    text({ x: 23, y: 9.9, pt: 25, bold: true, text: s.terminalCode }), // ②
    text({ x: 31, y: 14.2, pt: 10, bold: true, anchor: 'middle', text: fitText(s.terminalName, 15, 10) }), // 터미널명
    text({ x: 4.5, y: 17.8, pt: 9, bold: true, text: '출력일자 :' }),
    text({ x: 19.5, y: 17.8, pt: 7, bold: true, text: koreanDate(d.printedDate) }),
    text({ x: 61, y: 4.3, pt: 9, bold: true, text: `P. ${d.boxIndex}` }),
    text({ x: 69.5, y: 12.9, pt: fitSizePt(s.midCode, 9.5, 35, 20), bold: true, text: s.midCode }), // ④
    text({ x: 80, y: 12.9, pt: fitSizePt(s.courierSortCode, 19, 35, 20), bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 43.4, y: 17.8, pt: 8, text: s.centerCode }), // ⑤
    text({ x: 55.2, y: 17.8, pt: 8, text: fitText(s.centerName, 14, 8) }), // ⑥
    text({ x: 70, y: 17.8, pt: 8, text: fitText(`발지TML ${s.originTerminalCode} ${s.originTerminalName}`, 29, 8) }), // ⑦⑧
  ];

  // ── 배달표 ─────────────────────────────────────────────────────────────
  const deliverySlip = [
    text({ x: 8.2, y: 22.2, pt: 9, bold: true, text: maskName(rc.name) }),
    text({ x: 98, y: 22.2, pt: 9, bold: true, anchor: 'end', text: maskPhone(rc.phone) }),
    text({ x: 8.2, y: 25.2, pt: slipAddress.pt, text: slipAddress.text }),
    text({ x: 8.2, y: 31.8, pt: 9, bold: true, text: sd.name }),
    text({ x: 98, y: 31.8, pt: 9, bold: true, anchor: 'end', text: sd.phone }),
    text({ x: 8.2, y: 34.8, pt: 9, text: fitText(maskAddress(sd.baseAddress), 89.5, 9) }),
    text({ x: 13.4, y: 41.7, pt: message.pt, text: message.text }), // ⑭
    text({ x: 5.3, y: 48.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 21, y: 48.5, pt: 20, bold: true, text: fitText(s.courierName, 47, 20) }), // ⑪
    rect(68.7, 43, 16.7, 6.6), // ⑮ 상자
    text({ x: 77.05, y: 47.9, pt: 11, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
    rect(5.1, 50.1, 38.6, 6.2), // ⑬ 상자
    text({ x: 7, y: 55, pt: 14, bold: true, text: d.freightText }), // ⑬
    text({ x: 57.6, y: 60.7, pt: 9, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측상단(ITF 위)
    text({ x: 5.1, y: 61.4, pt: 10, text: koreanDate(d.printedDate) }),
    text({ x: 5.1, y: 64.6, pt: 10, text: `수량: ${d.boxCount}` }),
    text({ x: 24.2, y: 64.6, pt: 10, text: `운임Type:${d.boxType}` }),
    text({
      x: NL_CUST_ORD_NO_X_MM,
      y: 67.8,
      pt: fitSizePt(custText, NL_CUST_ORD_NO_MAX_WIDTH_MM, 10, 4),
      text: custText,
    }),
  ];

  // ── 받는고객용(배달표 외) ────────────────────────────────────────────────
  const customerCopy = [
    text({ x: 15.3, y: 74.7, pt: 9.5, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측하단
    text({ x: 44.2, y: 74.7, pt: 9.5, bold: true, text: `P. ${d.boxIndex}` }),
    text({ x: 15.3, y: 79.6, pt: 10, text: fitText(d.commodityName, 82.5, 10) }), // 품명
    text({ x: 8.2, y: 86, pt: 16, bold: true, text: fitText(s.addressSummary, 89.5, 16) }), // ⑫
    text({ x: 8.2, y: 93.1, pt: 9, bold: true, text: maskName(sd.name) }),
    text({ x: 98, y: 93.1, pt: 9, bold: true, anchor: 'end', text: maskPhone(sd.phone) }),
    text({ x: 8.2, y: 96.7, pt: 9, text: fitText(maskAddress(sd.baseAddress), 89.5, 9) }),
  ];

  const barcodes: BarcodePlacement[] = [
    ...(s.terminalCode
      ? [{ kind: 'CODE128' as const, data: s.terminalCode, xMm: 43, yMm: 5, heightMm: 8, moduleDots: 2 }] // ③
      : []),
    {
      kind: 'ITF',
      data: d.trackingNo,
      xMm: NL_ITF_X_MM,
      yMm: 62,
      heightMm: 14.5,
      moduleDots: ITF_MODULE_DOTS,
      wideRatio: 2.5,
    },
  ];

  return {
    widthMm: WIDTH_MM,
    heightMm: HEIGHT_MM,
    rotation: 0,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [
      ['sort-head', sortHead],
      ['delivery-slip', deliverySlip],
      ['customer-copy', customerCopy],
    ]),
    barcodes,
  };
}
