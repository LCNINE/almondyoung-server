import { PRINT_PRODUCTS } from "@/domains/almond-template/lib/catalog"
import { AlmondTemplateEditor } from "@/domains/almond-template/components/editor"
import { notFound } from "next/navigation"

type Props = {
  searchParams: Promise<{
    product?: string
    variant?: string
    size?: string
    template?: string
  }>
}

export const metadata = { title: "아몬드템플릿 편집" }

export default async function EditAlmondTemplatePage({ searchParams }: Props) {
  const {
    product = "",
    variant = "",
    size = "",
    template = "",
  } = await searchParams
  if (!product || !PRINT_PRODUCTS[product]) notFound()
  return (
    <AlmondTemplateEditor
      productId={product}
      variantId={variant}
      size={size}
      templateId={template}
      mode="customer"
    />
  )
}
