import { templateProductOf } from "@/domains/almond-template/lib/template-product"
import { listAlmondTemplates } from "@/lib/api/ugc/almond-templates"
import { AlmondTemplateEditor } from "@/domains/almond-template/components/editor"
import { notFound } from "next/navigation"

type Props = {
  searchParams: Promise<{
    product?: string
    variant?: string
    size?: string
    template?: string
    saved?: string
  }>
}

export const metadata = { title: "아몬드템플릿 편집" }

export default async function EditAlmondTemplatePage({ searchParams }: Props) {
  const {
    product = "",
    variant = "",
    size = "",
    template = "",
    saved = "",
  } = await searchParams
  if (!product) notFound()
  const templates = await listAlmondTemplates().catch(() => [])
  const templateProduct = templateProductOf(product, templates)
  if (!templateProduct) notFound()
  return (
    <AlmondTemplateEditor
      productId={product}
      templateProduct={templateProduct}
      variantId={variant}
      size={size}
      templateId={template}
      savedId={saved}
      mode="customer"
    />
  )
}
