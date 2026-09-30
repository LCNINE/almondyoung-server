import { AlmondTemplateEditor } from "@/domains/almond-template/components/editor"
import { AlmondTemplateGallery } from "@/domains/almond-template/components/gallery"
import { PRINT_PRODUCTS } from "@/domains/almond-template/lib/catalog"
import { HttpApiError } from "@/lib/api/api-error"
import { parseDesign } from "@/domains/almond-template/lib/document"
import {
  getAdminAlmondTemplate,
  listAdminAlmondTemplates,
  listAlmondTemplates,
} from "@/lib/api/ugc/almond-templates"
import { notFound } from "next/navigation"

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{
    product?: string
    variant?: string
    mode?: string
    size?: string
    template?: string
  }>
}

export const metadata = { title: "아몬드템플릿" }

export default async function AlmondTemplatePage({
  params,
  searchParams,
}: Props) {
  const { countryCode } = await params
  const {
    product = "",
    variant = "",
    mode,
    size = "",
    template = "",
  } = await searchParams
  if (product && !PRINT_PRODUCTS[product]) notFound()
  if (mode !== "designer")
    return (
      <AlmondTemplateGallery
        countryCode={countryCode}
        productId={product}
        variantId={variant}
        size={size}
        templates={await listAlmondTemplates().catch(() => null)}
      />
    )
  const editing = await (
    template ? getAdminAlmondTemplate(template) : listAdminAlmondTemplates()
  ).catch((error) => {
    if (
      error instanceof HttpApiError &&
      (error.status === 403 || error.status === 404)
    )
      notFound()
    throw error
  })
  if (template && "design" in editing) {
    return (
      <AlmondTemplateEditor
        productId={editing.productId}
        size={editing.size}
        initialDesign={parseDesign(editing.design)}
        mode="designer"
      />
    )
  }
  return (
    <AlmondTemplateEditor
      productId={product}
      variantId={variant}
      size={size}
      mode="designer"
    />
  )
}
