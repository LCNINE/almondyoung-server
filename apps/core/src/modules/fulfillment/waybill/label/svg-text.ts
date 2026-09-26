/** SVG 텍스트 헬퍼. 폰트 메트릭 없이 칸 폭을 판정한다 — 라벨 칸 넘침만 막으면 되므로 근사로 충분하다. */

export const PT_TO_MM = 0.3528;

// 전각(한글 음절·자모, CJK, 전각 기호)은 1em, 나머지는 0.6em. 나눔고딕 라틴 평균보다 약간 넉넉하게 잡았다.
// eslint-disable-next-line no-irregular-whitespace -- U+3000(전각 공백)은 CJK 기호 범위의 실제 시작점이지, 실수로 들어간 공백이 아니다.
const WIDE = /[ᄀ-ᇿ　-鿿가-힣＀-￯]/;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function textWidthMm(text: string, sizePt: number): number {
  const em = Array.from(text).reduce((sum, ch) => sum + (WIDE.test(ch) ? 1 : 0.6), 0);
  return em * sizePt * PT_TO_MM;
}

/** 칸 폭을 넘으면 뒤를 잘라 `…` 를 붙인다. 줄바꿈하지 않는다 — 선인쇄 칸을 넘는다. */
export function fitText(text: string, maxWidthMm: number, sizePt: number): string {
  if (textWidthMm(text, sizePt) <= maxWidthMm) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && textWidthMm(`${chars.join('')}…`, sizePt) > maxWidthMm) chars.pop();
  return `${chars.join('')}…`;
}

/** 자르면 안 되는 식별자용 — 칸에 들어가는 가장 큰 크기(0.5pt 단위, 최소 minPt). */
export function fitSizePt(text: string, maxWidthMm: number, maxPt: number, minPt: number): number {
  for (let pt = maxPt; pt > minPt; pt -= 0.5) {
    if (textWidthMm(text, pt) <= maxWidthMm) return pt;
  }
  return minPt;
}
