import type { AlmondTemplateSummary } from "@/lib/types/ui/almond-template"

export type PaperVariant = "uncoated" | "matte_coated"

// 종이 질감을 보여 줄 인쇄물. 모양이 달라 3D 모델·카메라 거리·확대 사진이 따로 있다
export type PaperShape = "card" | "card_portrait" | "nail"

export const PAPER_MODELS: Record<
  PaperShape,
  { src: string; cameraOrbit: string; macroPrefix: string }
> = {
  card: {
    src: "/almond-template/paper/card.glb",
    cameraOrbit: "30deg 64deg 0.31m",
    macroPrefix: "/almond-template/paper/macro-",
  },
  card_portrait: {
    src: "/almond-template/paper/card-portrait.glb",
    cameraOrbit: "30deg 64deg 0.31m",
    macroPrefix: "/almond-template/paper/macro-",
  },
  nail: {
    src: "/almond-template/paper/nail.glb",
    cameraOrbit: "30deg 64deg 0.4m",
    macroPrefix: "/almond-template/paper/nail-macro-",
  },
}

const SHAPE_BY_KIND: Record<string, PaperShape> = {
  bizcard: "card",
  card: "card",
  nail: "nail",
}

export function paperVariantOf(value?: string): PaperVariant | undefined {
  if (value?.includes("무광코팅")) return "matte_coated"
  if (value?.includes("무코팅")) return "uncoated"

  return undefined
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
    shape: shape === "card" && template.size === "50x90" ? "card_portrait" : shape,
  }
}
