import { AlmondTemplateLanding } from "@/domains/almond-template/components/landing"
import {
  PRINT_PRODUCTS,
  type PrintKind,
} from "@/domains/almond-template/lib/catalog"
import { published } from "@/domains/almond-template/lib/gallery-filter"
import { listAlmondTemplates } from "@/lib/api/ugc/almond-templates"

export const metadata = { title: "아몬드템플릿" }

export default async function AlmondTemplateLandingPage() {
  const templates = (await listAlmondTemplates().catch(() => null)) ?? []

  const thumbnails: Partial<Record<PrintKind, string>> = {}

  for (const item of templates.filter(published)) {
    const kind = PRINT_PRODUCTS[item.productId].kind
    thumbnails[kind] ??= item.thumbnail
  }

  return <AlmondTemplateLanding thumbnails={thumbnails} />
}
