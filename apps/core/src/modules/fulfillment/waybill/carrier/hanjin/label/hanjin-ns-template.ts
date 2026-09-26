import type { BarcodePlacement, LabelSpec } from '../../../label/label-model';
import { escapeXml, fitSizePt, fitText, PT_TO_MM } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';

/**
 * 한진 NS형(좌 100 + 우 100 = 200 × 102mm) 자체출력 운송장(#913).
 *
 * **검은색 요소(가변 데이터)만** 그린다 — 테두리·영역 캡션·로고·개인정보 안내 문구는 한진 라벨지에
 * 선인쇄돼 있다. 좌표는 포털 NS 샘플 실측(mm), y 는 기준선, 폰트 크기는 필드표의 pt.
 *
 * 면별 마스킹(정본 §3.3, 2026-09-27 정정):
 *   받는고객용(배달표 외) — 받는분·보낸분 전부 마스킹
 *   배달표 — 받는분 성명·연락처 마스킹 + 주소 원본 / 보낸분 성명·연락처 원본 + 주소 미표기
 */

const WIDTH_MM = 200;
const HEIGHT_MM = 102;
const R = 100; // 우측 절반 원점

interface TextEl {
  x: number;
  y: number;
  pt: number;
  text: string;
  bold?: boolean;
  anchor?: 'middle' | 'end';
}

function text(t: TextEl): string {
  const weight = t.bold ? ' font-weight="700"' : '';
  const anchor = t.anchor ? ` text-anchor="${t.anchor}"` : '';
  return `<text x="${t.x}" y="${t.y}" font-size="${(t.pt * PT_TO_MM).toFixed(2)}"${weight}${anchor}>${escapeXml(t.text)}</text>`;
}

function rect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="0.4"/>`;
}

function hline(x1: number, x2: number, y: number): string {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#000" stroke-width="0.3"/>`;
}

function koreanDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

/**
 * 배달표 받는분 전체주소·⑭ 처럼 «잘리면 곤란한» 긴 필드용: 말줄임 전에 먼저 글자 크기를 줄인다
 * (최소 7pt). 그래도 안 들어가면 그 크기에서 말줄임으로 자른다(#913 최종리뷰) — 실측 주소
 * (「…현대아파트 101동 1203호」류)와 ⑭ 끝의 「(공동현관 #…)」가 fitText 단독으로는 잘려 나갔다.
 */
function shrinkThenFit(t: string, maxWidthMm: number, basePt: number): { pt: number; text: string } {
  const pt = fitSizePt(t, maxWidthMm, basePt, 7);
  return { pt, text: fitText(t, maxWidthMm, pt) };
}

export function renderHanjinNsLabel(d: HanjinLabelData): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const sd = d.sender;

  // 자르면 곤란한 필드 — 말줄임 전에 먼저 줄인다(위 shrinkThenFit 주석 참고).
  const leftDeliveryMessage = shrinkThenFit(d.deliveryMessage, 66, 9); // ⑭ 좌측
  const slipDeliveryMessage = shrinkThenFit(d.deliveryMessage, 90, 9); // ⑭ 배달표
  const slipRecipientAddress = shrinkThenFit(`${rc.baseAddress} ${rc.detailAddress}`, 87, 10); // 배달표 받는분 주소(원본)

  // ── 좌측: 분류 + 품명 + 배송요구사항 + 권역 ─────────────────────────────
  const left = [
    text({ x: 3.8, y: 15.5, pt: 40, bold: true, text: s.hubCode }), // ①
    text({ x: 25, y: 15.5, pt: 40, bold: true, text: s.terminalCode }), // ②
    text({ x: 55, y: 15.5, pt: 40, bold: true, text: s.midCode }), // ④
    text({ x: 70.5, y: 15.5, pt: 40, bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 57.8, y: 5.2, pt: 9, bold: true, text: `P. ${d.boxIndex}` }),
    text({ x: 69.5, y: 5.2, pt: 9, bold: true, text: `${d.boxIndex}/${d.boxCount}` }),
    text({ x: 42.5, y: 21.5, pt: 9, anchor: 'middle', text: s.centerCode }), // ⑤
    text({ x: 42.5, y: 25, pt: 9, anchor: 'middle', text: s.centerName }), // ⑥
    text({ x: 55.5, y: 25.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 77, y: 25.5, pt: 20, bold: true, text: s.courierName }), // ⑪
    text({ x: 1.5, y: 32.3, pt: 10, text: fitText(d.commodityName, 93, 10) }), // 품명
    hline(1, 96, 33.5),
    text({ x: 2, y: 89.3, pt: leftDeliveryMessage.pt, text: leftDeliveryMessage.text }), // ⑭
    rect(70, 90.7, 27.3, 8), // ⑮ 상자
    text({ x: 83.6, y: 96.9, pt: 16, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
  ];

  // ── 우측 상단: 받는고객용 = 배달표 외 → 전부 마스킹 ──────────────────────
  const customerCopy = [
    text({ x: R + 19, y: 6.6, pt: 14, bold: true, text: d.trackingNoDisplay }), // ⑨
    text({ x: R + 8.5, y: 10.5, pt: 10, text: maskName(rc.name) }),
    text({ x: R + 96, y: 10.5, pt: 10, anchor: 'end', text: maskPhone(rc.phone) }),
    text({ x: R + 8.5, y: 14.4, pt: 10, text: fitText(maskAddress(rc.baseAddress), 87, 10) }),
    text({ x: R + 8.5, y: 23.5, pt: 10, text: maskName(sd.name) }),
    text({ x: R + 96, y: 23.5, pt: 10, anchor: 'end', text: maskPhone(sd.phone) }),
    text({ x: R + 8.5, y: 27.5, pt: 10, text: fitText(maskAddress(sd.baseAddress), 87, 10) }),
  ];

  // ── 우측 하단: 배달표 ───────────────────────────────────────────────────
  const custText = `출고번호: ${d.custOrdNo}`;
  const deliverySlip = [
    text({ x: R + 6, y: 42.7, pt: 24, bold: true, text: s.routeRank }), // ⑩
    text({ x: R + 26.7, y: 42.7, pt: 22, bold: true, text: s.courierName }), // ⑪
    text({ x: R + 52.3, y: 42.7, pt: 25, bold: true, text: `${s.hubCode} ${s.terminalCode}` }), // ①②
    text({ x: R + 83.2, y: 42.7, pt: 17, text: s.centerCode }), // ⑤
    rect(R + 6.8, 43.4, 37, 6.6), // ⑬ 상자
    text({ x: R + 8.2, y: 48.8, pt: 14, bold: true, text: d.freightText }), // ⑬
    text({ x: R + 6, y: 54.3, pt: 10, text: koreanDate(d.printedDate) }),
    text({ x: R + 6, y: 59.1, pt: 10, text: `수량: ${d.boxCount}` }),
    text({ x: R + 26, y: 59.1, pt: 10, text: `운임Type:${d.boxType}` }),
    text({ x: R + 6.7, y: 63.4, pt: fitSizePt(custText, 42, 10, 5), text: custText }),
    text({ x: R + 69.65, y: 66.7, pt: 9, anchor: 'middle', text: d.trackingNoDisplay }), // ⑨ ITF 아래(중앙)
    text({ x: R + 69.8, y: 71.5, pt: 9, text: `발지: ${s.originTerminalCode}` }), // ⑦
    text({ x: R + 86.7, y: 71.5, pt: 9, text: s.originTerminalName }), // ⑧
    text({ x: R + 6, y: 75.6, pt: slipDeliveryMessage.pt, text: slipDeliveryMessage.text }), // ⑭
    text({ x: R + 8.7, y: 79.5, pt: 10, text: maskName(rc.name) }),
    text({ x: R + 96, y: 79.5, pt: 10, anchor: 'end', text: maskPhone(rc.phone) }),
    text({ x: R + 8.7, y: 84, pt: slipRecipientAddress.pt, text: slipRecipientAddress.text }),
    text({ x: R + 8.7, y: 94.8, pt: 19, bold: true, text: fitText(s.addressSummary, 87, 19) }), // ⑫
    text({ x: R + 8.7, y: 100.3, pt: 9, text: sd.name }),
    text({ x: R + 96, y: 100.3, pt: 9, anchor: 'end', text: sd.phone }),
  ];

  const barcodes: BarcodePlacement[] = [
    ...(s.terminalCode
      ? [{ kind: 'CODE128' as const, data: s.terminalCode, xMm: 4.4, yMm: 18.3, heightMm: 8, moduleDots: 2 }] // ③
      : []),
    // xMm 는 quiet zone(≥10×module = 3.75mm) 확보를 위해 R+50 에서 시작한다 — 출고번호 텍스트가 5pt 까지
    // 줄어들어도 끝이 R+49.1 근처까지 와 3.15mm 로 좁혀졌었다(#913 최종리뷰). 폭 ~39.3mm(moduleDots 3,
    // wideRatio 2.5, 12자리) 이므로 R+89.3 에서 끝나 라벨(200mm) 안에 들어간다.
    { kind: 'ITF', data: d.trackingNo, xMm: R + 50, yMm: 43.8, heightMm: 20, moduleDots: 3, wideRatio: 2.5 },
  ];

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH_MM}mm" height="${HEIGHT_MM}mm" viewBox="0 0 ${WIDTH_MM} ${HEIGHT_MM}" font-family="NanumGothic">`,
    `<g id="left">${left.join('')}</g>`,
    `<g id="customer-copy">${customerCopy.join('')}</g>`,
    `<g id="delivery-slip">${deliverySlip.join('')}</g>`,
    '</svg>',
  ].join('');

  return { widthMm: WIDTH_MM, heightMm: HEIGHT_MM, svg, barcodes };
}
