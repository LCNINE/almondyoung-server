import { AlmondTemplateEditor } from "@/domains/almond-template/components/editor"
import { AlmondTemplateGallery } from "@/domains/almond-template/components/gallery"
import {
  PRINT_PRODUCTS,
  PRINT_SPECS,
  type PrintKind,
} from "@/domains/almond-template/lib/catalog"
import { ApiAuthError, HttpApiError } from "@/lib/api/api-error"
import { parseDesign } from "@/domains/almond-template/lib/document"
import {
  getAdminAlmondTemplate,
  listAdminAlmondTemplates,
  listAlmondTemplates,
} from "@/lib/api/ugc/almond-templates"
import { notFound, redirect } from "next/navigation"

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{
    product?: string
    kind?: string
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
    kind = "",
    variant = "",
    mode,
    size = "",
    template = "",
  } = await searchParams
  if (product && !PRINT_PRODUCTS[product]) notFound()
  if (mode !== "designer") {
    const [templates, canDesign] = await Promise.all([
      listAlmondTemplates().catch(() => null),
      listAdminAlmondTemplates().then(
        () => true,
        () => false
      ),
    ])
    return (
      <AlmondTemplateGallery
        countryCode={countryCode}
        productId={product}
        variantId={variant}
        size={size}
        initialKind={kind in PRINT_SPECS ? (kind as PrintKind) : undefined}
        templates={templates}
        canDesign={canDesign}
      />
    )
  }
  const editing = await (
    template ? getAdminAlmondTemplate(template) : listAdminAlmondTemplates()
  ).catch((error) => {
    // 토큰이 없거나 만료돼 갱신도 안 되면 에러 화면 대신 바로 로그인으로 보낸다.
    // 돌아올 주소에 template 을 남겨야 로그인 뒤 빈 편집기가 아니라 그 시안이 열린다
    if (error instanceof ApiAuthError) {
      const back = new URLSearchParams({ mode: "designer" })
      if (template) back.set("template", template)
      redirect(
        `/${countryCode}/login?redirect_to=${encodeURIComponent(`/${countryCode}/almond-template?${back}`)}`
      )
    }
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
        templateId={editing.id}
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
