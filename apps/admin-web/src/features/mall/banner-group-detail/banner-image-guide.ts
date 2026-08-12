/**
 * 배너 이미지 업로드 가이드 문구.
 *
 * 배너 슬롯은 CSS `aspect-ratio` + `object-cover` 라, 그룹 규격과 비율이 다른 이미지를 올리면
 * 중앙만 남기고 잘린다. AI 이미지 생성기(GPT 등)는 3:2(1536x1024)가 가장 가로로 긴 출력이라
 * 그보다 납작한 배너 슬롯에 넣으려면 반드시 위아래가 잘린다 — 그래서 "세로 중앙 N% 안에
 * 글자를 배치하라"는 안전 영역을 같이 알려준다.
 */

/** AI 생성기(gpt-image-1 등)가 뱉는 가로형 최대 비율 */
const AI_SOURCE_RATIO = 1.5;
const AI_SOURCE_LABEL = '1536×1024(3:2)';

/** 비율을 `3:1` 같은 읽기 쉬운 문자열로. 정수로 안 떨어지면 소수 한 자리 */
export function formatRatio(width: number, height: number): string {
  const ratio = width / height;
  return `${Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}:1`;
}

/**
 * 3:2 원본을 이 슬롯에 넣었을 때 살아남는 세로 비율(%).
 * 슬롯이 가로로 길수록 좁아진다 — 3:1 이면 50%, 2:1 이면 75%.
 */
export function safeZonePercent(width: number, height: number): number {
  const slotRatio = width / height;
  return Math.round((AI_SOURCE_RATIO / slotRatio) * 100);
}

export type BannerImageGuide = {
  /** 슬롯 규격 — `권장 1920×640 (3:1)` */
  spec: string;
  /** AI 생성 팁 — 안전 영역 안내 */
  tip: string;
};

export function bannerImageGuide(
  width: number | null | undefined,
  height: number | null | undefined,
): BannerImageGuide | null {
  if (!width || !height) return null;

  const ratio = formatRatio(width, height);
  const safe = safeZonePercent(width, height);

  return {
    spec: `권장 ${width}×${height} (${ratio})`,
    // 슬롯이 3:2 보다 세로로 길면 AI 출력이 통째로 들어가므로 안전 영역 안내가 필요 없다
    tip:
      safe >= 100
        ? `AI로 만들 땐 ${AI_SOURCE_LABEL}로 뽑으면 잘리지 않습니다`
        : `AI로 만들 땐 ${AI_SOURCE_LABEL}로 뽑고, 글자·로고를 세로 중앙 ${safe}% 안에 배치하세요`,
  };
}
