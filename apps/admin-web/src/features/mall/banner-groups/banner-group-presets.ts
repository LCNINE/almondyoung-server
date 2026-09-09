/**
 * 배너 그룹 규격 프리셋.
 *
 * 그룹을 만들 때 PC/모바일 픽셀을 직접 적게 하면 무엇을 넣어야 할지 알 수가 없다.
 * 스토어프론트에 «실재하는 자리»의 값만 둔다 — 없는 자리를 프리셋으로 제시하면
 * 그 규격으로 그룹을 만들어도 화면에 그려주는 코드가 없다.
 */

export type BannerGroupPreset = {
  label: string;
  hint: string;
  pcWidth: number;
  pcHeight: number;
  mobileWidth: number;
  mobileHeight: number;
};

/** 환산 기준으로 삼는 실제 화면 폭(px) — 스토어프론트 미리보기와 같은 값 */
export const PC_VIEWPORT = 1440;
export const MOBILE_VIEWPORT = 390;

/**
 * 규격은 픽셀 크기가 아니라 비율이다. `1920×480` 은 "4:1 로 그려라"는 뜻이고,
 * 실제 화면 높이는 뷰포트 폭을 그 비율로 나눈 값이 된다 — 1440px 화면이면 360px.
 * 관리자가 480 을 화면 높이로 착각하지 않도록 환산값을 같이 보여준다.
 */
export function renderedHeight(
  width: number | null | undefined,
  height: number | null | undefined,
  viewportWidth: number
): number | null {
  if (!width || !height) return null;
  return Math.round(viewportWidth / (width / height));
}

/** 지금 입력된 규격과 일치하는 프리셋 (없으면 null) */
export function matchPreset(size: {
  pcWidth?: number | null;
  pcHeight?: number | null;
  mobileWidth?: number | null;
  mobileHeight?: number | null;
}): BannerGroupPreset | null {
  return (
    BANNER_GROUP_PRESETS.find(
      (p) =>
        p.pcWidth === size.pcWidth &&
        p.pcHeight === size.pcHeight &&
        p.mobileWidth === size.mobileWidth &&
        p.mobileHeight === size.mobileHeight
    ) ?? null
  );
}

export const BANNER_GROUP_PRESETS: BannerGroupPreset[] = [
  {
    label: '큰 히어로',
    hint: '홈 최상단 대형 배너. 쿠팡과 같은 규격 (PC 1920×450 · 모바일 2.17:1)',
    pcWidth: 1920,
    pcHeight: 450,
    mobileWidth: 780,
    mobileHeight: 360,
  },
  {
    label: '얇은 가로 띠',
    hint: '안내·공지용 얇은 배너. 지금 멤버십 배너가 이 규격 (PC 10:1 · 모바일 2.2:1)',
    pcWidth: 1920,
    pcHeight: 187,
    mobileWidth: 375,
    mobileHeight: 169,
  },
];
