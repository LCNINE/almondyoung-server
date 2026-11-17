/** 한진 운송장 템플릿(NS·NL·FS) 공용 SVG 조각(#913). 좌표·크기는 mm, 글자 크기는 pt. */

import { fitSizePt, fitText } from '../../../../../../platform/label/svg-text';
import { svgDocument, text, wrapLines, type TextEl } from '../../../../../../platform/label/svg-elements';

export { svgDocument, text, wrapLines, type TextEl };

export function rect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="0.4"/>`;
}

export function hline(x1: number, x2: number, y: number): string {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#000" stroke-width="0.3"/>`;
}

export function koreanDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

/**
 * 배달표 받는분 전체주소·⑭ 처럼 «잘리면 곤란한» 긴 필드용: 말줄임 전에 먼저 글자 크기를 줄인다
 * (최소 7pt). 그래도 안 들어가면 그 크기에서 말줄임으로 자른다(#913 최종리뷰) — 실측 주소
 * (「…현대아파트 101동 1203호」류)와 ⑭ 끝의 「(공동현관 #…)」가 fitText 단독으로는 잘려 나갔다.
 */
export function shrinkThenFit(t: string, maxWidthMm: number, basePt: number): { pt: number; text: string } {
  const pt = fitSizePt(t, maxWidthMm, basePt, 7);
  return { pt, text: fitText(t, maxWidthMm, pt) };
}
