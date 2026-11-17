import type { AlmondTemplateSummary } from "@/lib/types/ui/almond-template"

export type PaperVariant = "uncoated" | "matte_coated"

// 3D·확대 사진은 저장소가 아니라 공개 버킷에 둔다. 고치면 이름의 버전을 올린다(1년 캐시)
export const PAPER_ASSETS =
  "https://almondyoung-public.s3.ap-northeast-2.amazonaws.com/storefront/almond-template/paper"

// 3D 로 보여 줄 인쇄물. 모양마다 모델·카메라 거리가 다르다.
// macros 는 용지를 고르는 종류만 있다. throughFront 는 투명 필름이라 뒷면에 앞면 그림이 비친다
export type PaperShape =
  | "card"
  | "card_portrait"
  | "nail"
  | "mini"
  | "pet"
  | "window"
  | "menu"

// 유리창 현수막은 3D 가 아니라 사진 합성(photo-mockup)으로 보여 준다
export type ModelShape = Exclude<PaperShape, "window">

export const PAPER_MODELS: Record<
  ModelShape,
  {
    src: string
    cameraOrbit: string
    macros?: Record<PaperVariant, string>
    throughFront?: boolean
  }
> = {
  card: {
    src: `${PAPER_ASSETS}/card-v1.glb`,
    cameraOrbit: "30deg 64deg 0.31m",
    macros: {
      uncoated: `${PAPER_ASSETS}/macro-uncoated-v1.jpg`,
      matte_coated: `${PAPER_ASSETS}/macro-matte_coated-v1.jpg`,
    },
  },
  card_portrait: {
    src: `${PAPER_ASSETS}/card-portrait-v1.glb`,
    cameraOrbit: "30deg 64deg 0.46m",
    macros: {
      uncoated: `${PAPER_ASSETS}/macro-uncoated-v1.jpg`,
      matte_coated: `${PAPER_ASSETS}/macro-matte_coated-v1.jpg`,
    },
  },
  nail: {
    src: `${PAPER_ASSETS}/nail-v1.glb`,
    cameraOrbit: "30deg 64deg 0.4m",
    macros: {
      uncoated: `${PAPER_ASSETS}/nail-macro-uncoated-v1.jpg`,
      matte_coated: `${PAPER_ASSETS}/nail-macro-matte_coated-v1.jpg`,
    },
  },
  mini: {
    src: `${PAPER_ASSETS}/mini-v1.glb`,
    cameraOrbit: "30deg 70deg 0.9m",
    throughFront: true,
  },
  pet: {
    src: `${PAPER_ASSETS}/pet-v1.glb`,
    cameraOrbit: "30deg 72deg 4.2m",
  },
  menu: {
    src: `${PAPER_ASSETS}/menu-v1.glb`,
    cameraOrbit: "30deg 75deg 1.08m",
  },
}

const SHAPE_BY_KIND: Record<string, PaperShape> = {
  bizcard: "card",
  card: "card",
  nail: "nail",
  mini: "mini",
  pet: "pet",
  window: "window",
  menu: "menu",
}

export function paperVariantOf(value?: string): PaperVariant | undefined {
  if (value?.includes("무광코팅")) return "matte_coated"
  if (value?.includes("무코팅")) return "uncoated"

  return undefined
}

// 용지를 골라 질감을 비교하는 종류(명함·네일팁)
export function choosesPaper(shape: PaperShape): boolean {
  return shape !== "window" && !!PAPER_MODELS[shape].macros
}

export function paperTemplateOf(
  productId: string,
  templates:
    | Pick<AlmondTemplateSummary, "id" | "productId" | "kind" | "size">[]
    | null
): { id: string; shape: PaperShape } | undefined {
  const template = templates?.find(
    (t) => t.productId === productId && !!t.kind && !!SHAPE_BY_KIND[t.kind]
  )
  if (!template?.kind) return undefined

  const shape = SHAPE_BY_KIND[template.kind]

  return {
    id: template.id,
    shape:
      shape === "card" && template.size === "50x90" ? "card_portrait" : shape,
  }
}
