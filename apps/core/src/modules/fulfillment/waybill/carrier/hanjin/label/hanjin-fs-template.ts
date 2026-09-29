import { DOTS_PER_MM, type BarcodePlacement, type LabelSpec } from '../../../label/label-model';
import { paginate, type LabelItem } from '../../../label/label-items';
import { fitSizePt, fitText, textWidthMm } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';
import { rect, shrinkThenFit, svgDocument, text, wrapLines } from './hanjin-label-svg';

/**
 * 한진 FS형(가로 123 × 세로 100mm) 자체출력 운송장(#913).
 *
 * 가로 123mm 가 인쇄폭(108mm)을 넘어 270° 돌려 짧은 변(100mm)을 폭으로 넣는다. **라벨 전체가 배달표 한 면**
 * 이라 받는고객용이 없다(포털 샘플 좌측 「배달표」 100mm 표시).
 *
 * **검은색 요소만** 그린다 — 테두리·캡션·로고·「※ 개인정보 보호를…」 안내문은 선인쇄. 좌표는 포털 FS 샘플
 * (fs_new.jpg) 실측 mm, y 는 기준선, 글자 크기는 필드표(fs2.jpg)의 pt. ⑯ 은 표 35pt 면 ⑨ 아래 선인쇄 선을
 * 넘어 샘플 크기(20pt)로 둔다. 샘플 ITF 위의 회색 「테스트」는 워터마크라 그리지 않는다.
 *
 * 샘플과 다른 곳 둘: 출력일자는 샘플의 보낸분 줄 오른쪽이 아니라 출고번호 줄 왼쪽에 둔다(보낸분 줄이
 * 7pt 로도 안 들어가 잘렸다). ⑭ 는 ITF 옆 좁은 칸이라 최대 두 줄로 나눈다.
 *
 * 마스킹(정본 §3.3 배달표): 받는분 성명·연락처 마스킹 + 주소 원본 / 보낸분 성명·연락처 원본 + 주소 마스킹.
 */

const WIDTH_MM = 123;
const HEIGHT_MM = 100;

const ITF_MODULE_DOTS = 3;
export const FS_ITF_X_MM = 76;
export const FS_ITF_QUIET_ZONE_MM = (10 * ITF_MODULE_DOTS) / DOTS_PER_MM;

const CODE128_MODULE_DOTS = 2;
const CODE128_X_MM = 94;
const CODE128_QUIET_ZONE_MM = (10 * CODE128_MODULE_DOTS) / DOTS_PER_MM;

/** ① 허브 코드는 ② 터미널코드 앞에서 멈춘다. */
const FS_HUB_X_MM = 5;
const FS_TERMINAL_X_MM = 24.5;

/** 받는분 칸(주소·⑫)은 ③ 터미널 바코드의 quiet zone 앞에서 멈춘다. */
const RECIPIENT_X_MM = 7.8;
const RECIPIENT_MAX_WIDTH_MM = CODE128_X_MM - CODE128_QUIET_ZONE_MM - RECIPIENT_X_MM - 0.5;
const FS_ADDRESS_SUMMARY_PT = 12;

/** ⑭ 는 ITF 와 같은 높이라 quiet zone 앞에서 멈춘다. */
const MESSAGE_X_MM = 8.8;
const MESSAGE_MAX_WIDTH_MM = FS_ITF_X_MM - FS_ITF_QUIET_ZONE_MM - MESSAGE_X_MM - 0.5;

/** 출고번호는 오른쪽 끝(x 119)에 붙이고 같은 줄 왼쪽의 출력일자(~x 40) 앞에서 멈춘다. 식별자라 자르지 않고 최소 4pt 까지 줄인다. */
export const FS_CUST_ORD_NO_MAX_WIDTH_MM = 75;

/**
 * 품목 영역(스펙 2026-09-28 품목 줄 §5.1) — 모든 쪽 같은 자리 4줄. 셀메이트 송장처럼 이 송장이 피킹 지시서다.
 * 좌표는 창고 FS 라벨지 실물 출력으로 확정하기 전 초기값(스펙 §9).
 */
export const FS_ITEMS_PER_PAGE = 4;
export const FS_ITEM_X_MM = 4.5;
export const FS_ITEM_QTY_X_MM = 119;
export const FS_ITEM_QTY_GAP_MM = 3;
export const FS_ITEM_PT = 11;
const FS_ITEM_MIN_PT = 8;
const FS_ITEM_FIRST_BASELINE_MM = 57;
const FS_ITEM_PITCH_MM = 5.2;
/** 쪽 표시 — 선인쇄 「※ 개인정보 보호…」(실측 y ≈81.7mm) 바로 위. */
const FS_PAGE_MARK_Y_MM = 80.6;

const STOP_BANNER = '발송 금지 · 상품 확인용';
const STOP_MARK = '발송 금지';

/** 이름 칸이 최소한 이 폭은 남도록 로케이션 접두어 칸을 넓힌다. */
export const FS_ITEM_NAME_MIN_WIDTH_MM = 20;
/** 로케이션 접두어를 줄일 수 있는 최소 pt. */
export const FS_ITEM_LOCATION_MIN_PT = 5;
const FS_ITEM_LOCATION_GAP_MM = 1.5;

/** 품목 이름 칸 폭 — 수량 앞 FS_ITEM_QTY_GAP_MM 에서 멈춘다. 위치 코드 접두어가 붙으면 그 폭(+간격)을 뺀다. */
export function fsItemNameMaxWidthMm(qty: string, locationPrefixWidthMm = 0): number {
  return FS_ITEM_QTY_X_MM - textWidthMm(qty, FS_ITEM_PT) - FS_ITEM_QTY_GAP_MM - FS_ITEM_X_MM - locationPrefixWidthMm;
}

const round1 = (mm: number) => Math.round(mm * 10) / 10;

function itemElements(items: readonly LabelItem[]): string[] {
  return items.flatMap((item, i) => {
    // 부동소수 꼬리(72.60000000000001)가 svg 좌표에 새지 않게 0.1mm 로 반올림한다.
    const y = round1(FS_ITEM_FIRST_BASELINE_MM + i * FS_ITEM_PITCH_MM);
    const qty = String(item.quantity);
    const prefix = `[${item.locationCode}]`;
    const prefixMax = fsItemNameMaxWidthMm(qty) - FS_ITEM_NAME_MIN_WIDTH_MM - FS_ITEM_LOCATION_GAP_MM;
    const prefixPt = fitSizePt(prefix, prefixMax, FS_ITEM_PT, FS_ITEM_LOCATION_MIN_PT);
    const prefixWidth = textWidthMm(prefix, prefixPt);
    // 로케이션 코드는 식별자라 자르지 않는다. 겹쳐 찍힌 피킹 지시서는 틀린 지시서보다 나쁘다 — 도달 불가에
    // 가까운 코드는 조용히 겹쳐 찍지 않고 크게 실패한다.
    if (prefixWidth > prefixMax) {
      throw new Error(
        `FS label: location code "${item.locationCode}" is too long to print without overlapping (max ${prefixMax.toFixed(1)}mm at ${FS_ITEM_LOCATION_MIN_PT}pt)`,
      );
    }
    const nameOffset = prefixWidth + FS_ITEM_LOCATION_GAP_MM;
    const maxWidth = fsItemNameMaxWidthMm(qty, nameOffset);
    const pt = fitSizePt(item.name, maxWidth, FS_ITEM_PT, FS_ITEM_MIN_PT);
    return [
      text({ x: FS_ITEM_X_MM, y, pt: prefixPt, bold: true, text: prefix }),
      text({ x: round1(FS_ITEM_X_MM + nameOffset), y, pt, text: fitText(item.name, maxWidth, pt) }),
      text({ x: FS_ITEM_QTY_X_MM, y, pt: FS_ITEM_PT, bold: true, anchor: 'end', text: qty }),
    ];
  });
}

/**
 * 품목이 4줄을 넘으면 같은 자리 레이아웃의 추가 쪽을 잇는다. 추가 쪽은 피킹·검수용이고 끝나면 버린다(사용자
 * 결정) — 짝 맞추기 정보(⑨·받는분 성명·보낸분·출고번호)만 남기고 바코드·주소·분류코드를 뺀다.
 */
export function renderHanjinFsLabel(d: HanjinLabelData): LabelSpec[] {
  const pages = paginate(d.items, FS_ITEMS_PER_PAGE);
  const qtySum = d.items.reduce((n, item) => n + item.quantity, 0);
  return pages.map((items, i) => {
    const shared = [
      ...sharedElements(d),
      ...itemElements(items),
      text({
        x: FS_ITEM_X_MM,
        y: FS_PAGE_MARK_Y_MM,
        pt: 9,
        // 판차 자리: 스펙 §10.1-4 가 위치를 실측으로 정하라 했다. 실물로 자리를 확인한 이 줄(y 80.6)에 붙이면
        // 새 좌표 실측이 필요 없다. 실물 확인은 Task 15 스모크. NS·NL 은 품목 줄·판차를 그리지 않는다(운영은 FS).
        text: `${d.revision >= 2 ? `${d.revision}판 · ` : ''}${i + 1}/${pages.length} · 총 ${d.items.length}건 ${qtySum}개`,
      }),
    ];
    return i === 0 ? firstPage(d, shared) : continuationPage(shared);
  });
}

/** 모든 쪽 같은 자리 — 찢은 뒤 첫 쪽과 짝을 맞추는 단서. */
function sharedElements(d: HanjinLabelData): string[] {
  const rc = d.recipient;
  const sd = d.sender;
  const senderLine = shrinkThenFit(`${sd.name} / ${sd.phone} / ${maskAddress(sd.baseAddress)}`, 111, 9);
  const custText = `출고번호: ${d.custOrdNo}`;
  return [
    // 선인쇄 가로선(실측 y 7.4–8.0 · 24.3–24.6 · 44.4–44.9 · 52.0–52.5mm)을 글자가 밟지 않게 잡았다 —
    // 2026-09-28 창고 FS 라벨지 실물 출력 스캔으로 ⑨·⑪·보낸분 줄을 옮겼다.
    text({ x: 15.3, y: 6.8, pt: 8, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측상단
    // 성명(x 7.8)이 길면 고정 x=35.1 의 연락처를 침범한다(#913 최종리뷰 F5) — 연락처 앞에서 멈춘다.
    text({ x: RECIPIENT_X_MM, y: 27.7, pt: 10, text: fitText(maskName(rc.name), 35.1 - RECIPIENT_X_MM - 1, 10) }),
    text({ x: 35.1, y: 27.7, pt: 10, text: maskPhone(rc.phone) }),
    text({ x: RECIPIENT_X_MM, y: 48.3, pt: senderLine.pt, text: senderLine.text }),
    text({ x: RECIPIENT_X_MM, y: 51.5, pt: 8, text: `${d.printedDate} Type : ${d.boxType}` }),
    text({
      x: 119,
      y: 51.5,
      pt: fitSizePt(custText, FS_CUST_ORD_NO_MAX_WIDTH_MM, 10, 4),
      anchor: 'end',
      text: custText,
    }),
  ];
}

function firstPage(d: HanjinLabelData, shared: readonly string[]): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const address = shrinkThenFit(`${rc.baseAddress} ${rc.detailAddress}`, RECIPIENT_MAX_WIDTH_MM, 10);
  const messageLines = wrapLines(d.deliveryMessage, MESSAGE_MAX_WIDTH_MM, 9, 2); // ⑭
  const messageY = messageLines.length === 1 ? [93.7] : [89.5, 93.7];

  const own = [
    // ── 분류 ──
    // ① 허브 코드는 영문 2자라 글자마다 폭이 크게 다르다 — 35pt 고정이면 `MG`(제주)가 ② 와 겹쳤다
    // (2026-09-29 한진 DEV 샘플). ② 앞 0.5mm 에서 멈추도록 줄인다 — `SS` 는 35pt 로 딱 맞는다.
    text({
      x: FS_HUB_X_MM,
      y: 19.4,
      pt: fitSizePt(s.hubCode, FS_TERMINAL_X_MM - FS_HUB_X_MM - 0.5, 35, 20),
      bold: true,
      text: s.hubCode,
    }), // ①
    text({ x: FS_TERMINAL_X_MM, y: 19.4, pt: 25, bold: true, text: s.terminalCode }), // ②
    text({ x: 42.5, y: 19.4, pt: fitSizePt(s.midCode, 9.5, 35, 20), bold: true, text: s.midCode }), // ④
    text({ x: 5.8, y: 22.6, pt: 8, text: fitText(`발지:${s.originTerminalCode} ${s.originTerminalName}`, 35, 8) }), // ⑦⑧
    text({ x: 57.8, y: 13.5, pt: fitSizePt(s.courierSortCode, 18, 20, 12), bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 78, y: 13.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 52.8, y: 23, pt: 20, bold: true, text: fitText(s.courierName, 24, 20) }), // ⑪
    text({ x: 78, y: 19.4, pt: 8, text: s.centerCode }), // ⑤
    text({ x: 78, y: 23.1, pt: 8, text: fitText(s.centerName, 19, 8) }), // ⑥
    rect(98.5, 17, 20.5, 6.4), // ⑮ 상자
    text({ x: 108.75, y: 22, pt: 11, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
    // ── 받는분 주소 ──
    text({ x: RECIPIENT_X_MM, y: 31.3, pt: address.pt, text: address.text }),
    // ⑫ 필드표(fs2)는 「19」지만 샘플 그림(fs_new)은 ≈11.3pt 로 그렸다 — 19 면 한글 주소가 대부분 잘린다.
    text({
      x: RECIPIENT_X_MM,
      y: 39.4,
      pt: FS_ADDRESS_SUMMARY_PT,
      bold: true,
      text: fitText(s.addressSummary, RECIPIENT_MAX_WIDTH_MM, FS_ADDRESS_SUMMARY_PT),
    }), // ⑫
    rect(91.5, 36.7, 27.3, 6.4), // ⑬ 상자
    text({ x: 105.15, y: 41.8, pt: 14, bold: true, anchor: 'middle', text: d.freightText }), // ⑬
    // ── 하단 ──
    ...messageLines.map((line, i) => text({ x: MESSAGE_X_MM, y: messageY[i], pt: 9, text: line })), // ⑭
    text({ x: 74.5, y: 95.5, pt: 8, text: `운임Type : ${d.boxType}` }),
    text({ x: 119, y: 95.5, pt: 8, bold: true, anchor: 'end', text: d.trackingNoDisplay }), // ⑨ 좌측하단
  ];

  const barcodes: BarcodePlacement[] = [
    ...(s.terminalCode
      ? [
          {
            kind: 'CODE128' as const,
            data: s.terminalCode,
            xMm: CODE128_X_MM,
            yMm: 27,
            heightMm: 8,
            moduleDots: CODE128_MODULE_DOTS,
          },
        ] // ③
      : []),
    {
      kind: 'ITF',
      data: d.trackingNo,
      xMm: FS_ITF_X_MM,
      yMm: 80.5,
      heightMm: 12,
      moduleDots: ITF_MODULE_DOTS,
      wideRatio: 2.5,
    },
  ];

  return {
    widthMm: WIDTH_MM,
    heightMm: HEIGHT_MM,
    // 창고 FS 라벨지는 90° 로 넣으면 선인쇄와 위아래가 뒤집혀 나온다(2026-09-28 실물 출력).
    rotation: 270,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [['delivery-slip', [...shared, ...own]]]),
    barcodes,
  };
}

/**
 * 추가 쪽: 분류 띠와 ITF 자리 두 곳에 「발송 금지」 — 찢은 조각이 어느 쪽으로 놓여도 보이게. ⑨ 는 가리지 않는다
 * (셀메이트는 ⑨ 위에 겹쳐 찍었지만 그게 짝 맞추기 단서다). 바코드 0 — 잘못 붙어도 터미널이 읽을 것이 없다.
 */
function continuationPage(shared: readonly string[]): LabelSpec {
  const marks = [
    text({ x: 5, y: 19.4, pt: fitSizePt(STOP_BANNER, 113, 28, 18), bold: true, text: STOP_BANNER }),
    text({ x: 97.5, y: 89.5, pt: fitSizePt(STOP_MARK, 43, 28, 18), bold: true, anchor: 'middle', text: STOP_MARK }),
  ];
  return {
    widthMm: WIDTH_MM,
    heightMm: HEIGHT_MM,
    rotation: 270,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [['continuation', [...shared, ...marks]]]),
    barcodes: [],
  };
}
