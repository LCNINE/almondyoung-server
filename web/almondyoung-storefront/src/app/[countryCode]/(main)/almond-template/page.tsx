import { AlmondTemplateEditor } from "@/domains/almond-template/components/editor"
import { AlmondTemplateGallery } from "@/domains/almond-template/components/gallery"
import { PRINT_PRODUCTS } from "@/domains/almond-template/lib/catalog"
import { HttpApiError } from "@/lib/api/api-error"
import {
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
  }>
}

export const metadata = { title: "아몬드템플릿" }

export default async function AlmondTemplatePage({
  params,
  searchParams,
}: Props) {
  const { countryCode } = await params
  const { product = "", variant = "", mode, size = "" } = await searchParams
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
  try {
    await listAdminAlmondTemplates()
  } catch (error) {
    if (error instanceof HttpApiError && error.status === 403) notFound()
    throw error
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
