/** 한진 운송장 템플릿(NS·NL·FS) 공용 SVG 조각(#913). 좌표·크기는 mm, 글자 크기는 pt. */

import { escapeXml, fitSizePt, fitText, PT_TO_MM, textWidthMm } from '../../../label/svg-text';

export interface TextEl {
  x: number;
  y: number;
  pt: number;
  text: string;
  bold?: boolean;
  anchor?: 'middle' | 'end';
}

export function text(t: TextEl): string {
  const weight = t.bold ? ' font-weight="700"' : '';
  const anchor = t.anchor ? ` text-anchor="${t.anchor}"` : '';
  return `<text x="${t.x}" y="${t.y}" font-size="${(t.pt * PT_TO_MM).toFixed(2)}"${weight}${anchor}>${escapeXml(t.text)}</text>`;
}

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

/** 라벨 SVG 문서. viewBox 는 mm, 글꼴은 번들 나눔고딕. 면 블록은 `<g id>` 로 나눠 테스트가 면별로 검사한다. */
export function svgDocument(
  widthMm: number,
  heightMm: number,
  blocks: ReadonlyArray<readonly [string, readonly string[]]>,
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" font-family="NanumGothic">`,
    ...blocks.map(([id, els]) => `<g id="${id}">${els.join('')}</g>`),
    '</svg>',
  ].join('');
}

/**
 * 좁은 칸의 자유 텍스트를 최대 maxLines 줄로 나눈다 — 줄마다 칸 폭 안에서 마지막 공백에서 끊고(없으면
 * 글자 단위), 그래도 남는 것은 마지막 줄에서 말줄임. FS ⑭ 가 ITF 옆 63mm 칸이라 한 줄로는 공동현관
 * 비밀번호가 잘려서 생겼다(계획 작성 때 시제품 실측).
 */
export function wrapLines(t: string, maxWidthMm: number, pt: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = t.trim();
  while (lines.length < maxLines - 1 && textWidthMm(rest, pt) > maxWidthMm) {
    const chars = Array.from(rest);
    let n = chars.length;
    while (n > 1 && textWidthMm(chars.slice(0, n).join(''), pt) > maxWidthMm) n--;
    const space = chars.slice(0, n).lastIndexOf(' ');
    const cut = space > 0 ? space : n;
    lines.push(chars.slice(0, cut).join('').trimEnd());
    rest = chars.slice(cut).join('').trimStart();
  }
  lines.push(fitText(rest, maxWidthMm, pt));
  return lines;
}
