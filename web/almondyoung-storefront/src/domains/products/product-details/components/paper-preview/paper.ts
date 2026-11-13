import type { AlmondTemplateSummary } from "@/lib/types/ui/almond-template"

export type PaperVariant = "uncoated" | "matte_coated"

export function paperVariantOf(value?: string): PaperVariant | undefined {
  if (value?.includes("무광코팅")) return "matte_coated"
  if (value?.includes("무코팅")) return "uncoated"

  return undefined
}

export function paperTemplateOf(
  productId: string,
  templates: Pick<AlmondTemplateSummary, "id" | "productId" | "kind">[] | null
) {
  return templates?.find(
    (template) =>
      template.productId === productId &&
      (template.kind === "bizcard" || template.kind === "card")
  )
}
