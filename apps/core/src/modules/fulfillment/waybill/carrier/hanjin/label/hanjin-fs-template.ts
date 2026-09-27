import { DOTS_PER_MM, type BarcodePlacement, type LabelSpec } from '../../../label/label-model';
import { fitSizePt, fitText } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';
import { rect, shrinkThenFit, svgDocument, text, wrapLines } from './hanjin-label-svg';

/**
 * 한진 FS형(가로 123 × 세로 100mm) 자체출력 운송장(#913).
 *
 * 가로 123mm 가 인쇄폭(108mm)을 넘어 90° 돌려 짧은 변(100mm)을 폭으로 넣는다. **라벨 전체가 배달표 한 면**
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

/** 받는분 칸(주소·⑫)은 ③ 터미널 바코드의 quiet zone 앞에서 멈춘다. */
const RECIPIENT_X_MM = 7.8;
const RECIPIENT_MAX_WIDTH_MM = CODE128_X_MM - CODE128_QUIET_ZONE_MM - RECIPIENT_X_MM - 0.5;

/** ⑭ 는 ITF 와 같은 높이라 quiet zone 앞에서 멈춘다. */
const MESSAGE_X_MM = 8.8;
const MESSAGE_MAX_WIDTH_MM = FS_ITF_X_MM - FS_ITF_QUIET_ZONE_MM - MESSAGE_X_MM - 0.5;

/** 출고번호는 오른쪽 끝(x 119)에 붙이고 같은 줄 왼쪽의 출력일자(~x 40) 앞에서 멈춘다. 식별자라 자르지 않고 최소 4pt 까지 줄인다. */
export const FS_CUST_ORD_NO_MAX_WIDTH_MM = 75;

export function renderHanjinFsLabel(d: HanjinLabelData): LabelSpec {
  const s = d.sort;
  const rc = d.recipient;
  const sd = d.sender;

  const address = shrinkThenFit(`${rc.baseAddress} ${rc.detailAddress}`, RECIPIENT_MAX_WIDTH_MM, 10);
  const messageLines = wrapLines(d.deliveryMessage, MESSAGE_MAX_WIDTH_MM, 9, 2); // ⑭
  const messageY = messageLines.length === 1 ? [93.7] : [89.5, 93.7];
  const senderLine = shrinkThenFit(`${sd.name} / ${sd.phone} / ${maskAddress(sd.baseAddress)}`, 111, 9);
  const custText = `출고번호: ${d.custOrdNo}`;

  const slip = [
    // ── 머리: 운송장번호 + 분류 ──
    text({ x: 15.3, y: 7.3, pt: 8, bold: true, text: d.trackingNoDisplay }), // ⑨ 좌측상단
    text({ x: 5, y: 19.4, pt: 35, bold: true, text: s.hubCode }), // ①
    text({ x: 24.5, y: 19.4, pt: 25, bold: true, text: s.terminalCode }), // ②
    text({ x: 42.5, y: 19.4, pt: fitSizePt(s.midCode, 9.5, 35, 20), bold: true, text: s.midCode }), // ④
    text({ x: 5.8, y: 22.6, pt: 8, text: fitText(`발지:${s.originTerminalCode} ${s.originTerminalName}`, 35, 8) }), // ⑦⑧
    text({ x: 57.8, y: 13.5, pt: fitSizePt(s.courierSortCode, 18, 20, 12), bold: true, text: s.courierSortCode }), // ⑯
    text({ x: 78, y: 13.5, pt: 20, bold: true, text: s.routeRank }), // ⑩
    text({ x: 52.8, y: 23.9, pt: 20, bold: true, text: fitText(s.courierName, 24, 20) }), // ⑪
    text({ x: 78, y: 19.4, pt: 8, text: s.centerCode }), // ⑤
    text({ x: 78, y: 23.1, pt: 8, text: fitText(s.centerName, 19, 8) }), // ⑥
    rect(98.5, 17, 20.5, 6.4), // ⑮ 상자
    text({ x: 108.75, y: 22, pt: 11, bold: true, anchor: 'middle', text: d.regionText }), // ⑮
    // ── 받는분 ──
    // 성명(x 7.8)이 길면 고정 x=35.1 의 연락처를 침범한다(#913 최종리뷰 F5) — 연락처 앞에서 멈춘다.
    text({ x: RECIPIENT_X_MM, y: 27.7, pt: 10, text: fitText(maskName(rc.name), 35.1 - RECIPIENT_X_MM - 1, 10) }),
    text({ x: 35.1, y: 27.7, pt: 10, text: maskPhone(rc.phone) }),
    text({ x: RECIPIENT_X_MM, y: 31.3, pt: address.pt, text: address.text }),
    text({
      x: RECIPIENT_X_MM,
      y: 39.4,
      pt: 19,
      bold: true,
      text: fitText(s.addressSummary, RECIPIENT_MAX_WIDTH_MM, 19),
    }), // ⑫
    rect(91.5, 36.7, 27.3, 6.4), // ⑬ 상자
    text({ x: 105.15, y: 41.8, pt: 14, bold: true, anchor: 'middle', text: d.freightText }), // ⑬
    // ── 보낸분 · 출력일자 · 출고번호 ──
    text({ x: RECIPIENT_X_MM, y: 47.4, pt: senderLine.pt, text: senderLine.text }),
    text({ x: RECIPIENT_X_MM, y: 51.2, pt: 8, text: `${d.printedDate} Type : ${d.boxType}` }),
    text({
      x: 119,
      y: 51.2,
      pt: fitSizePt(custText, FS_CUST_ORD_NO_MAX_WIDTH_MM, 10, 4),
      anchor: 'end',
      text: custText,
    }),
    // ── 본문 · 하단 ──
    text({ x: 4.5, y: 56.8, pt: 12, bold: true, text: fitText(d.commodityName, 114, 12) }), // 품명
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
    rotation: 90,
    svg: svgDocument(WIDTH_MM, HEIGHT_MM, [['delivery-slip', slip]]),
    barcodes,
  };
}
