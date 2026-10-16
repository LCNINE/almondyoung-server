export const SANS_FONT = "'Noto Sans KR', 'Noto Sans CJK KR', sans-serif"
export const SERIF_FONT = "'Noto Serif KR', 'Noto Serif CJK KR', serif"

// [표시 이름, CSS family, Google Fonts 요청(없는 굵기를 요청하면 시트 전체가 400 이다)]
const GOOGLE_FONTS = [
  ["나눔고딕", "Nanum Gothic", "Nanum+Gothic:wght@400;700", "sans-serif"],
  ["나눔명조", "Nanum Myeongjo", "Nanum+Myeongjo:wght@400;700", "serif"],
  ["고딕 A1", "Gothic A1", "Gothic+A1:wght@400;700", "sans-serif"],
  [
    "IBM Plex Sans KR",
    "IBM Plex Sans KR",
    "IBM+Plex+Sans+KR:wght@400;700",
    "sans-serif",
  ],
  ["고운바탕", "Gowun Batang", "Gowun+Batang:wght@400;700", "serif"],
  ["고운돋움", "Gowun Dodum", "Gowun+Dodum", "sans-serif"],
  ["검은고딕", "Black Han Sans", "Black+Han+Sans", "sans-serif"],
  ["도현", "Do Hyeon", "Do+Hyeon", "sans-serif"],
  ["주아", "Jua", "Jua", "sans-serif"],
  ["송명", "Song Myung", "Song+Myung", "serif"],
  ["동글", "Dongle", "Dongle:wght@400;700", "sans-serif"],
  ["해바라기", "Sunflower", "Sunflower:wght@300;700", "sans-serif"],
  ["나눔손글씨 펜", "Nanum Pen Script", "Nanum+Pen+Script", "cursive"],
  ["나눔손글씨 붓", "Nanum Brush Script", "Nanum+Brush+Script", "cursive"],
  ["감자꽃", "Gamja Flower", "Gamja+Flower", "cursive"],
  ["하이멜로디", "Hi Melody", "Hi+Melody", "cursive"],
] as const

export type FontOption = { label: string; value: string }

export const FONT_OPTIONS: FontOption[] = [
  { label: "Noto Sans KR", value: SANS_FONT },
  { label: "Noto Serif KR", value: SERIF_FONT },
  ...GOOGLE_FONTS.map(([label, family, , fallback]) => ({
    label,
    value: `'${family}', ${fallback}`,
  })),
]

export const FONT_STYLESHEET = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&family=Noto+Serif+KR:wght@400;700&${GOOGLE_FONTS.map(([, , query]) => `family=${query}`).join("&")}&display=swap`

export function fontStack(family: string | undefined) {
  if (family && FONT_OPTIONS.some((font) => font.value === family))
    return family
  return family && /serif/i.test(family) && !/sans-serif/i.test(family)
    ? SERIF_FONT
    : SANS_FONT
}
