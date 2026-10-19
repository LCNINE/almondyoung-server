// 그리기 패널의 손그림·그래픽. 망고보드 원본이 아니라 직접 그린 100×100 좌표 패스다.
// stroke 는 색을 선으로, fill 은 면으로 칠한다. 색은 레이어 fill 하나로 바뀐다
export type DrawArt = {
  label: string
  d: string
  mode: "stroke" | "fill"
  width?: number
  dash?: string
}

export const HAND_ART: Record<string, DrawArt> = {
  "hand-round": {
    label: "동그라미",
    mode: "stroke",
    d: "M58,12 C30,8 8,28 10,52 C12,78 36,92 60,88 C84,84 94,62 90,40 C86,20 66,8 38,15",
  },
  "hand-x": {
    label: "엑스",
    mode: "stroke",
    d: "M18,16 C36,36 62,62 84,86 M82,14 C62,34 40,60 16,84",
  },
  "hand-check": {
    label: "체크",
    mode: "stroke",
    d: "M12,52 C22,60 32,72 40,84 C54,58 70,34 90,12",
  },
  "hand-star": {
    label: "별",
    mode: "stroke",
    d: "M50,8 L61,39 L94,40 L68,60 L79,92 L51,73 L21,91 L32,60 L6,41 L39,39 Z",
  },
  "hand-heart": {
    label: "하트",
    mode: "stroke",
    d: "M50,88 C30,72 8,56 10,34 C12,16 34,10 48,30 C58,10 86,10 90,32 C94,56 70,72 50,88",
  },
  "hand-emphasis": {
    label: "강조",
    mode: "stroke",
    d: "M50,10 C50,20 51,30 52,42 M16,26 C22,34 28,42 34,52 M86,24 C80,32 74,40 68,50",
  },
  "hand-laughter": {
    label: "웃음",
    mode: "stroke",
    d: "M10,64 C18,38 34,36 42,62 M58,62 C66,36 82,38 90,64",
  },
  "hand-anger": {
    label: "화남",
    mode: "stroke",
    d: "M38,10 C40,26 34,36 12,38 M62,10 C60,26 66,36 88,38 M12,62 C34,64 40,74 38,90 M88,62 C66,64 60,74 62,90",
  },
  "hand-pigtail": {
    label: "돼지꼬리",
    mode: "stroke",
    d: "M6,70 C24,70 34,62 40,46 C46,26 70,24 70,44 C70,62 48,64 50,46 C52,30 74,30 94,30",
  },
  "hand-dotted": {
    label: "점선 동그라미",
    mode: "stroke",
    dash: "0 13",
    d: "M50,10 C72,10 90,28 90,50 C90,72 72,90 50,90 C28,90 10,72 10,50 C10,28 28,10 50,10",
  },
}

export const GRAPHIC_ART: Record<string, DrawArt> = {
  "graphic-thick-arrow": {
    label: "굵은 화살표",
    mode: "fill",
    d: "M4,36 L62,36 L62,14 L96,50 L62,86 L62,64 L4,64 Z",
  },
  "graphic-swoosh-arrow": {
    label: "휘어진 화살표",
    mode: "fill",
    d: "M6,86 C10,48 38,28 68,28 L68,10 L96,40 L68,70 L68,50 C46,50 24,62 6,86 Z",
  },
  "graphic-angled-bubble": {
    label: "각진 말풍선",
    mode: "fill",
    d: "M6,8 L94,8 L94,70 L46,70 L22,94 L28,70 L6,70 Z",
  },
  "graphic-round-bubble": {
    label: "둥근 말풍선",
    mode: "fill",
    d: "M50,6 C76,6 96,21 96,40 C96,59 76,74 50,74 C44,74 38,73 33,72 L14,92 L20,67 C10,60 4,51 4,40 C4,21 24,6 50,6 Z",
  },
  "graphic-zigzag": {
    label: "지그재그",
    mode: "stroke",
    width: 10,
    d: "M6,70 L21,30 L36,70 L51,30 L66,70 L81,30 L94,62",
  },
}

export const DRAW_ART: Record<string, DrawArt> = { ...HAND_ART, ...GRAPHIC_ART }
