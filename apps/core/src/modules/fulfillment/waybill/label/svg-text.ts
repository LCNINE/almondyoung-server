/** SVG 텍스트 헬퍼. 폰트 메트릭 없이 칸 폭을 판정한다 — 라벨 칸 넘침만 막으면 되므로 근사로 충분하다. */

export const PT_TO_MM = 0.3528;

/*
 * 글자 폭 모델(em) — 번들 나눔고딕의 실제 advance 를 «절대 과소추정하지 않게» 등급별 상한으로 잡는다(#913).
 *
 * 옛 모델(전각 0.9em · 나머지 0.6em)은 평균에 맞춘 근사라 실제보다 좁게 쟀다: 출고번호가 칸에 맞는다고
 * 판정한 크기로 그리면 잉크가 R+50~54 까지 나가 ITF 바코드(R+50 시작)를 덮었고, 공백 없는 한글
 * 줄(⑭·품명)도 칸을 ~4% 넘었다. 칸 판정은 과대추정해도 글자가 조금 작아질 뿐이지만 과소추정하면
 * 선인쇄 칸·바코드를 침범하므로, 각 등급 계수는 그 등급 글자들의 «최대» advance 이상으로 둔다.
 *
 * 실측 — NanumGothic-Regular/Bold.ttf 의 hmtx(unitsPerEm 1000, 두 굵기 advance 동일. 굵게는 잉크만
 * ~0.015em 두꺼워 advance 안에 든다):
 *   등급                                   실측 최대(em)            계수
 *   한글 음절·호환자모·CJK·전각(U+3000–9FFF 등)  0.940 (전 글자 동일)        0.95
 *   공백                                   0.280                   0.3
 *   좁은 기호 ! " ' ( ) , - . / : ; [ \ ] ` { | }  0.491 (`) · 0.430 (")       0.5
 *   숫자 · 소문자(m·w 제외)                   0.606 (숫자 전부, b d g h …)  0.62
 *   ASCII 대문자(G O Q M W 제외)·나머지 기호     0.727 (A D H N U &)        0.75
 *   G O Q                                  0.797 (G)               0.82
 *   M W m w @                              1.029 (W) · 0.969 (M)    1.05
 *   % · 그 밖의 BMP(라틴-1·기호·말줄임 …)       1.090 (%) · 1.081 (¾)     1.1
 *   BMP 밖(이모지 등 — 폰트에 없어 .notdef)      0.940 (.notdef advance)  1.0
 * 폰트에 없는 BMP 글자(한자 대부분·①·자모 U+1100 대)도 .notdef(0.940)로 그려지므로 위 등급 안에 든다.
 * resvg 는 연속 공백을 하나로 접으므로 공백 계수는 그만큼 더 넉넉하다. 실제 렌더와의 대조는
 * svg-text.spec.ts 의 「실제 렌더 폭을 과소추정하지 않는다」가 지킨다.
 */
const WIDE = /[\u1100-\u11FF\u3000-\u9FFF\uAC00-\uD7A3\uFF00-\uFFEF]/;
const NARROW_PUNCT = /[!"'(),\-./:;[\\\]`{|}]/;
const DIGIT_OR_NARROW_LOWER = /[0-9a-ln-vx-z]/;
const ROUND_UPPER = /[GOQ]/;
const WIDE_LATIN = /[MWmw@]/;
const PRINTABLE_ASCII = /[\x21-\x7E]/;

function charEm(ch: string): number {
  if ((ch.codePointAt(0) ?? 0) > 0xffff) return 1.0;
  if (WIDE.test(ch)) return 0.95;
  if (ch === ' ') return 0.3;
  if (NARROW_PUNCT.test(ch)) return 0.5;
  if (DIGIT_OR_NARROW_LOWER.test(ch)) return 0.62;
  if (ROUND_UPPER.test(ch)) return 0.82;
  if (WIDE_LATIN.test(ch)) return 1.05;
  if (ch !== '%' && PRINTABLE_ASCII.test(ch)) return 0.75;
  return 1.1;
}

// XML 1.0 이 금지하는 문자(tab·LF·CR 제외 C0 제어문자, U+FFFE/U+FFFF). resvg 는 이걸 만나면
// `non-XML character` 로 SVG 파싱 자체를 실패시켜 그 배송 라벨이 통째로 인쇄 불능이 된다 —
// 배송메시지·품명처럼 고객이 입력하는 값에 섞여 들어올 수 있어 이스케이프 전에 제거한다.
// eslint-disable-next-line no-control-regex -- 의도적으로 C0 제어문자를 걸러내는 필터다.
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(s: string): string {
  return s
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function textWidthMm(text: string, sizePt: number): number {
  const em = Array.from(text).reduce((sum, ch) => sum + charEm(ch), 0);
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
