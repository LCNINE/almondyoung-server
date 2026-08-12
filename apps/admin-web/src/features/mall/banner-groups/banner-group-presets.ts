/**
 * 배너 그룹 규격 프리셋.
 *
 * 그룹을 만들 때 PC/모바일 픽셀을 직접 적게 하면 무엇을 넣어야 할지 알 수가 없다.
 * 실제로 쓰이는 자리별로 검증된 값을 골라 넣게 한다.
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
  viewportWidth: number,
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
        p.mobileHeight === size.mobileHeight,
    ) ?? null
  );
}

export const BANNER_GROUP_PRESETS: BannerGroupPreset[] = [
  {
    label: '메인 히어로',
    hint: '홈 최상단 대형 배너 (PC 3:1 · 모바일 2:1)',
    pcWidth: 1920,
    pcHeight: 640,
    mobileWidth: 750,
    mobileHeight: 375,
  },
  {
    label: '중간 띠배너',
    hint: '섹션 사이 가로 배너 (PC 4:1 · 모바일 2:1)',
    pcWidth: 1920,
    pcHeight: 480,
    mobileWidth: 750,
    mobileHeight: 375,
  },
  {
    label: '얇은 안내 배너',
    hint: '공지·안내용 얇은 띠 (PC 10:1 · 모바일 2.2:1)',
    pcWidth: 1920,
    pcHeight: 192,
    mobileWidth: 750,
    mobileHeight: 338,
  },
];
