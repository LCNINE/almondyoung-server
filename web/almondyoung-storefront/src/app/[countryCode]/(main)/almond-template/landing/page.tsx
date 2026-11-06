import {
  AlmondTemplateLanding,
  type LandingCard,
} from "@/domains/almond-template/components/landing"
import {
  PRINT_PRODUCTS,
  PRINT_SPECS,
  type PrintKind,
} from "@/domains/almond-template/lib/catalog"
import { published } from "@/domains/almond-template/lib/gallery-filter"
import { getBannerGroupByCode } from "@/lib/api/pim/banner"
import {
  listAlmondTemplateCategories,
  listAlmondTemplates,
} from "@/lib/api/ugc/almond-templates"
import { getActiveBanners, isBannerGroupVisible } from "@/lib/utils/banner"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

export const metadata = { title: "아몬드템플릿" }

const HERO_BANNER_GROUP = "ALMOND_TEMPLATE_HERO"

const FALLBACK_DESCRIPTIONS: Record<PrintKind, string> = {
  pet: "가게 앞에 세워 손님을 부르는 입간판",
  mini: "카운터·테이블 위 작은 홍보 배너",
  window: "유리창에 붙여 지나가는 손님에게",
  card: "시술 후 관리법을 한 장으로 안내",
  bizcard: "샵 이름과 연락처를 담은 명함",
  nail: "네일팁을 붙여 보여주는 디스플레이",
  menu: "시술 메뉴와 가격을 깔끔하게",
  diploma: "교육 수료를 증명하는 디플로마",
}

const FALLBACK_ORDER: PrintKind[] = [
  "pet",
  "mini",
  "window",
  "card",
  "bizcard",
  "nail",
  "menu",
  "diploma",
]

const isPrintKind = (kind: string): kind is PrintKind => kind in PRINT_SPECS

// 어드민에 카테고리가 하나도 없을 때만 쓴다. 종류마다 가장 최근 시안 썸네일을 보여 준다
async function fallbackCards(): Promise<LandingCard[]> {
  const templates = (await listAlmondTemplates().catch(() => null)) ?? []
  const thumbnails: Partial<Record<PrintKind, string>> = {}

  for (const item of templates.filter(published)) {
    const kind = PRINT_PRODUCTS[item.productId].kind
    thumbnails[kind] ??= item.thumbnail
  }

  return FALLBACK_ORDER.map((kind) => ({
    id: kind,
    kind,
    name: PRINT_SPECS[kind].label,
    description: FALLBACK_DESCRIPTIONS[kind],
    image: thumbnails[kind] ?? null,
    photo: false,
  }))
}

export default async function AlmondTemplateLandingPage() {
  const [categories, bannerGroup] = await Promise.all([
    listAlmondTemplateCategories().catch(() => []),
    getBannerGroupByCode(HERO_BANNER_GROUP).catch(() => null),
  ])

  const cards: LandingCard[] = categories.flatMap((category) =>
    isPrintKind(category.kind)
      ? [
          {
            id: category.id,
            kind: category.kind,
            name: category.name,
            description: category.description,
            image: getThumbnailUrl(category.imageFileId),
            photo: true,
          },
        ]
      : []
  )

  const banners = isBannerGroupVisible(bannerGroup)
    ? getActiveBanners(bannerGroup.banners)
    : []

  return (
    <AlmondTemplateLanding
      cards={cards.length > 0 ? cards : await fallbackCards()}
      banners={banners}
    />
  )
}
