export const SANS_FONT = "'Noto Sans KR', 'Noto Sans CJK KR', sans-serif"
export const SERIF_FONT = "'Noto Serif KR', 'Noto Serif CJK KR', serif"

export const FONT_OPTIONS = [
  { label: "Noto Sans KR", value: SANS_FONT },
  { label: "Noto Serif KR", value: SERIF_FONT },
] as const

export const FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&family=Noto+Serif+KR:wght@400;700&display=swap"

export function fontStack(family: string | undefined) {
  return family && /serif/i.test(family) && !/sans-serif/i.test(family)
    ? SERIF_FONT
    : SANS_FONT
}
