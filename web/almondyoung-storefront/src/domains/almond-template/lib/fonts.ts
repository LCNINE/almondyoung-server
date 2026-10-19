export const SANS_FONT = "'Noto Sans KR', 'Noto Sans CJK KR', sans-serif"
export const SERIF_FONT = "'Noto Serif KR', 'Noto Serif CJK KR', serif"

// [표시 이름, CSS family, Google Fonts 요청(없는 굵기를 요청하면 시트 전체가 400 이다), fallback, 분류]
const GOOGLE_FONTS = [
  [
    "나눔고딕",
    "Nanum Gothic",
    "Nanum+Gothic:wght@400;700",
    "sans-serif",
    "고딕",
  ],
  [
    "나눔명조",
    "Nanum Myeongjo",
    "Nanum+Myeongjo:wght@400;700",
    "serif",
    "명조",
  ],
  ["고딕 A1", "Gothic A1", "Gothic+A1:wght@400;700", "sans-serif", "고딕"],
  [
    "IBM Plex Sans KR",
    "IBM Plex Sans KR",
    "IBM+Plex+Sans+KR:wght@400;700",
    "sans-serif",
    "고딕",
  ],
  ["고운바탕", "Gowun Batang", "Gowun+Batang:wght@400;700", "serif", "명조"],
  ["고운돋움", "Gowun Dodum", "Gowun+Dodum", "sans-serif", "고딕"],
  ["검은고딕", "Black Han Sans", "Black+Han+Sans", "sans-serif", "제목"],
  ["도현", "Do Hyeon", "Do+Hyeon", "sans-serif", "제목"],
  ["주아", "Jua", "Jua", "sans-serif", "제목"],
  ["송명", "Song Myung", "Song+Myung", "serif", "명조"],
  ["동글", "Dongle", "Dongle:wght@400;700", "sans-serif", "제목"],
  ["해바라기", "Sunflower", "Sunflower:wght@300;700", "sans-serif", "고딕"],
  [
    "나눔손글씨 펜",
    "Nanum Pen Script",
    "Nanum+Pen+Script",
    "cursive",
    "손글씨",
  ],
  [
    "나눔손글씨 붓",
    "Nanum Brush Script",
    "Nanum+Brush+Script",
    "cursive",
    "손글씨",
  ],
  ["감자꽃", "Gamja Flower", "Gamja+Flower", "cursive", "손글씨"],
  ["하이멜로디", "Hi Melody", "Hi+Melody", "cursive", "손글씨"],
  [
    "나눔고딕코딩",
    "Nanum Gothic Coding",
    "Nanum+Gothic+Coding:wght@400;700",
    "sans-serif",
    "고딕",
  ],
  ["스타일리쉬", "Stylish", "Stylish", "sans-serif", "고딕"],
  ["오르빗", "Orbit", "Orbit", "sans-serif", "고딕"],
  ["디필레이아", "Diphylleia", "Diphylleia", "serif", "명조"],
  ["그랜디플로라", "Grandiflora One", "Grandiflora+One", "serif", "명조"],
  ["베이글", "Bagel Fat One", "Bagel+Fat+One", "sans-serif", "제목"],
  ["가석", "Gasoek One", "Gasoek+One", "sans-serif", "제목"],
  ["개구쟁이", "Gaegu", "Gaegu:wght@400;700", "cursive", "손글씨"],
  ["서툰이야기", "Poor Story", "Poor+Story", "cursive", "손글씨"],
  ["귀여운 폰트", "Cute Font", "Cute+Font", "cursive", "손글씨"],
  ["동해 독도", "East Sea Dokdo", "East+Sea+Dokdo", "cursive", "손글씨"],
  ["독도", "Dokdo", "Dokdo", "cursive", "손글씨"],
  ["연성", "Yeon Sung", "Yeon+Sung", "cursive", "장식"],
  ["구기", "Gugi", "Gugi", "cursive", "장식"],
  ["싱글데이", "Single Day", "Single+Day", "cursive", "장식"],
  ["기랑해랑", "Kirang Haerang", "Kirang+Haerang", "cursive", "장식"],
  ["모이라이", "Moirai One", "Moirai+One", "cursive", "장식"],
  [
    "흑백사진",
    "Black And White Picture",
    "Black+And+White+Picture",
    "sans-serif",
    "레트로",
  ],
] as const

export const FONT_CATEGORIES = [
  "고딕",
  "명조",
  "제목",
  "손글씨",
  "장식",
  "레트로",
  "추가 글꼴",
] as const

export type FontCategory = (typeof FONT_CATEGORIES)[number]

export type FontOption = {
  label: string
  value: string
  category: FontCategory
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "Noto Sans KR", value: SANS_FONT, category: "고딕" },
  { label: "Noto Serif KR", value: SERIF_FONT, category: "명조" },
  ...GOOGLE_FONTS.map(([label, family, , fallback, category]) => ({
    label,
    value: `'${family}', ${fallback}`,
    category,
  })),
]

export const FONT_STYLESHEET = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&family=Noto+Serif+KR:wght@400;700&${GOOGLE_FONTS.map(([, , query]) => `family=${query}`).join("&")}&display=swap`

// 디자이너가 올린 글꼴. 이름(AF + fileId 32자리)은 ugc-service 의 almondFontFamily 와 같고 인쇄도 이 이름으로 찾는다
const UPLOADED_FONT = new RegExp(`^'(AF([0-9a-f]{32}))', ${SANS_FONT}$`)

export const uploadedFontValue = (family: string) => `'${family}', ${SANS_FONT}`

export type UploadedFont = { id: string; name: string; family: string }

let uploaded: UploadedFont[] = []
let allOptions = FONT_OPTIONS
const listeners = new Set<() => void>()

export function setUploadedFonts(fonts: UploadedFont[]) {
  uploaded = fonts
  allOptions = [
    ...FONT_OPTIONS,
    ...fonts.map((font) => ({
      label: font.name,
      value: uploadedFontValue(font.family),
      category: "추가 글꼴" as const,
    })),
  ]
  listeners.forEach((listener) => listener())
}

export function subscribeFontOptions(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const fontOptions = () => allOptions
export const uploadedFonts = () => uploaded

const loading = new Map<string, Promise<void>>()

// 쓰일 때만 받는다(한 글꼴이 수십 MB 일 수 있다). 목록에서 지운 글꼴도 이미 쓴 시안에선 계속 받는다
export function loadUploadedFont(value: string | undefined) {
  const match = value?.match(UPLOADED_FONT)
  if (!match || typeof document === "undefined") return undefined
  const [, family, hex] = match
  let pending = loading.get(family)
  if (!pending) {
    const fileId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    const face = new FontFace(
      family,
      `url(/api/almond-template/font/${fileId})`
    )
    document.fonts.add(face)
    pending = face.load().then(
      () => undefined,
      () => {
        loading.delete(family)
      }
    )
    loading.set(family, pending)
  }
  return pending
}

export function fontStack(family: string | undefined) {
  if (
    family &&
    (FONT_OPTIONS.some((font) => font.value === family) ||
      UPLOADED_FONT.test(family))
  )
    return family
  return family && /serif/i.test(family) && !/sans-serif/i.test(family)
    ? SERIF_FONT
    : SANS_FONT
}
